import {
  bots,
  businessProfiles,
  conversations,
  createDb,
  type DbHandle,
  jobs,
  leads,
  messages,
  outboundMessages,
  runMigrations,
  smsOptOuts,
  tenants,
  usageEvents,
} from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  type ContentBlock,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
} from "@traiblazer/llm";
import { FakeTelephony } from "@traiblazer/telephony";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JOB_TYPES } from "../jobs.js";
import {
  applyMessageStatus,
  handleInboundText,
  handleMissedCall,
  SMS_DAILY_LIMIT,
  type SmsNumber,
  sendQueuedText,
} from "./sms.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let owner: DbHandle;
let app: DbHandle;
let number: SmsNumber;
const OURS = "+18075550142";
/** A different customer for each test, so their threads and limits don't mix. */
let customer = "";
let serial = 0;

interface Turn {
  text?: string;
  calls?: { name: string; input: unknown }[];
}

class Scripted implements LLMProvider {
  readonly id = "scripted";
  requests: ChatRequest[] = [];
  script: (request: ChatRequest, call: number) => Turn = () => ({ text: "Yes, we do." });
  supportsImages() {
    return false;
  }
  supportsTools() {
    return true;
  }
  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push({ ...request, messages: [...request.messages] });
    const turn = this.script(request, this.requests.length);
    if (turn.text) yield { type: "text", text: turn.text };
    const content: ContentBlock[] = [
      ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
      ...(turn.calls ?? []).map((c, i) => ({ type: "tool_call" as const, id: `call_${i}`, ...c })),
    ];
    yield {
      type: "done",
      model,
      stopReason: turn.calls?.length ? "tool_use" : "end",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      message: { role: "assistant", content },
    };
  }
}

const model = new Scripted();
const gateway = new LLMGateway({
  providers: [model, new OfflineProvider()],
  routes: { chat: [{ provider: "scripted", model: "m" }], aux: [{ provider: "offline", model: "echo" }] },
});
// Starts at the real time: the engine stamps messages with it, and the tests move on from there.
let now = new Date();
const deps = () => ({ db: app.db, gateway, now: () => now });
const text = (body: string, from = customer) => handleInboundText(deps(), number, { from, text: body });
const sentTo = (to = customer) =>
  owner.db
    .select()
    .from(outboundMessages)
    .where(and(eq(outboundMessages.botId, number.botId), eq(outboundMessages.toNumber, to)))
    .orderBy(asc(outboundMessages.createdAt));
const threads = (from = customer) =>
  owner.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.botId, number.botId), eq(conversations.visitorId, from)))
    .orderBy(asc(conversations.createdAt));

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 4 });
  const [t] = await owner.db
    .insert(tenants)
    .values({ name: "Smith Plumbing", slug: `sms-${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  const [b] = await owner.db
    .insert(bots)
    .values({
      tenantId: t!.id,
      name: "Smith bot",
      pack: "trades",
      variant: "plumbing",
      languages: ["en", "fr"],
    })
    .returning();
  await owner.db.insert(businessProfiles).values({
    tenantId: t!.id,
    botId: b!.id,
    businessName: "Smith & Sons Plumbing",
    phone: "(519) 555-0100",
  });
  number = { tenantId: t!.id, botId: b!.id, e164: OURS };
});

beforeEach(() => {
  customer = `+1807555${String(1000 + serial++)}`;
  model.requests = [];
  model.script = () => ({ text: "Yes, we do." });
  now = new Date();
});

afterAll(async () => {
  await owner?.db.delete(tenants).where(eq(tenants.id, number.tenantId));
  await app?.close();
  await owner?.close();
});

describe("a text to the assistant's number", () => {
  it("is answered in plain text, and the reply is queued for the worker", async () => {
    model.script = () => ({ text: "**Yes**, we fix leaks.\n\n- Call us\n[[action:call]]" });
    expect(await text("Do you fix leaking faucets?")).toBe("answered");

    const [out] = await sentTo();
    expect(out).toMatchObject({
      kind: "reply",
      status: "queued",
      fromNumber: OURS,
      body: "Yes, we fix leaks.\n\n- Call us",
      segments: 1,
    });
    const queued = await owner.db.select().from(jobs).where(eq(jobs.type, JOB_TYPES.messageSend));
    expect(queued.some((j) => j.payload.messageId === out!.id)).toBe(true);

    // The model is told how to write a text, and gets no photos to show.
    const system = model.requests[0]!.system.map((b) => b.text).join("\n");
    expect(system).toContain("# This conversation is by text message (SMS)");
    expect(system).not.toContain("<photo id=");
    const [thread] = await threads();
    expect(thread).toMatchObject({ channel: "sms", visitorId: customer });
    expect(out!.conversationId).toBe(thread!.id);
  });

  it("continues the thread within a day and starts a new one after", async () => {
    await text("Do you fix leaks?");
    now = new Date(now.getTime() + 3 * 3600_000);
    await text("How much?");
    expect(await threads()).toHaveLength(1);
    // The follow-up reaches the model with the earlier exchange.
    expect(model.requests.at(-1)!.messages.length).toBeGreaterThan(1);

    now = new Date(now.getTime() + 25 * 3600_000);
    await text("Are you open Saturday?");
    expect(await threads()).toHaveLength(2);
    expect(model.requests.at(-1)!.messages).toHaveLength(1);
  });

  it("passes a request on with the number the customer texts from", async () => {
    model.script = (_request, call) =>
      call === 1
        ? {
            calls: [
              {
                name: "request_follow_up",
                input: { kind: "callback", name: "Alex Doe", request: "Wants a call about a leaking tap." },
              },
            ],
          }
        : { text: "Thanks Alex, I've passed that on." };
    expect(await text("Please call me about a leaking tap. I'm Alex Doe.")).toBe("answered");
    const [lead] = await owner.db.select().from(leads).where(eq(leads.botId, number.botId));
    expect(lead).toMatchObject({ channel: "sms", name: "Alex Doe", phone: customer, kind: "callback" });
  });

  it("stops on STOP, stays quiet until START, and answers HELP itself", async () => {
    expect(await text("Stop")).toBe("stopped");
    expect(await sentTo()).toEqual([]);
    expect(await text("Do you fix leaks?")).toBe("opted_out");
    expect(await text("HELP")).toBe("opted_out");
    expect(await sentTo()).toEqual([]);
    expect(model.requests).toEqual([]);

    expect(await text("START")).toBe("resumed");
    expect(await text("aide")).toBe("help");
    expect(await text("Do you fix leaks?")).toBe("answered");
    const sent = await sentTo();
    expect(sent.map((m) => m.kind)).toEqual(["system", "system", "reply"]);
    expect(sent[1]!.body).toBe(
      "Smith & Sons Plumbing: automated assistant. To talk to someone, call (519) 555-0100. Reply STOP to stop these messages.",
    );
  });

  it("says so, with the phone number, when the answer fails", async () => {
    model.script = () => {
      throw new Error("model down");
    };
    expect(await text("Do you fix leaks?")).toBe("failed");
    const [out] = await sentTo();
    expect(out!.body).toBe("Sorry, I can't answer right now. Please call (519) 555-0100.");
  });

  it("answers a number a limited number of times a day, and says so once", async () => {
    const [thread] = await owner.db
      .insert(conversations)
      .values({ ...number, channel: "sms", visitorId: customer, lastMessageAt: now })
      .returning();
    const { e164: _, ...scope } = number;
    await owner.db.insert(messages).values(
      Array.from({ length: SMS_DAILY_LIMIT }, () => ({
        tenantId: scope.tenantId,
        conversationId: thread!.id,
        role: "user" as const,
        content: "again",
        createdAt: now,
      })),
    );
    expect(await text("one more")).toBe("limited");
    expect(await text("and another")).toBe("limited");
    const sent = await sentTo();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain("That's a lot of messages for one day");
    expect(model.requests).toEqual([]);
  });

  it("doesn't answer for a paused assistant", async () => {
    await owner.db.update(bots).set({ status: "paused" }).where(eq(bots.id, number.botId));
    try {
      expect(await text("Hello?")).toBe("unavailable");
      expect(await handleMissedCall(deps(), number, { from: customer })).toBeNull();
      expect(await sentTo()).toEqual([]);
    } finally {
      await owner.db.update(bots).set({ status: "active" }).where(eq(bots.id, number.botId));
    }
  });
});

describe("a missed call", () => {
  it("gets one text a day, which opens the conversation", async () => {
    const first = await handleMissedCall(deps(), number, { from: customer });
    expect(first).toMatchObject({ texted: true, language: "en" });
    expect(first!.say).toContain("Thanks for calling Smith & Sons Plumbing");
    const [out] = await sentTo();
    expect(out).toMatchObject({ kind: "text_back" });
    expect(out!.body).toBe(
      "Sorry we missed your call. This is Smith & Sons Plumbing's automated assistant. What can we help you with? Reply STOP to opt out.",
    );

    expect(await handleMissedCall(deps(), number, { from: customer })).toMatchObject({ texted: false });
    expect(await sentTo()).toHaveLength(1);

    // The customer's reply continues the thread the text opened.
    await text("My sink is leaking");
    expect(await threads()).toHaveLength(1);
    expect(JSON.stringify(model.requests.at(-1)!.messages)).toContain("Sorry we missed your call");

    now = new Date(now.getTime() + 25 * 3600_000);
    expect(await handleMissedCall(deps(), number, { from: customer })).toMatchObject({ texted: true });
  });

  it("sends nothing to a withheld number or one that opted out", async () => {
    const hidden = await handleMissedCall(deps(), number, { from: null });
    expect(hidden).toMatchObject({ texted: false });
    expect(hidden!.say).toContain("Please call back later");
    await text("STOP");
    expect(await handleMissedCall(deps(), number, { from: customer })).toMatchObject({ texted: false });
    expect(await sentTo()).toEqual([]);
  });

  it("speaks and writes French for a French business", async () => {
    await owner.db.update(bots).set({ defaultLanguage: "fr" }).where(eq(bots.id, number.botId));
    try {
      const result = await handleMissedCall(deps(), number, { from: customer });
      expect(result).toMatchObject({ language: "fr" });
      expect(result!.say).toContain("Merci d'avoir appelé");
      expect((await sentTo())[0]!.body).toContain("Répondez ARRET");
    } finally {
      await owner.db.update(bots).set({ defaultLanguage: "en" }).where(eq(bots.id, number.botId));
    }
  });
});

describe("sending a queued text", () => {
  const telephony = new FakeTelephony();
  const send = (id: string) =>
    sendQueuedText(
      {
        db: app.db,
        telephony,
        segmentCostMicros: 8300,
        statusCallbackUrl: (t, m) => `https://api.example/s?t=${t}&m=${m}`,
      },
      number.tenantId,
      id,
    );
  beforeEach(() => {
    telephony.sent = [];
    telephony.failing = null;
  });

  it("sends it once, records the cost, and follows the delivery report", async () => {
    await text("Do you fix leaks?");
    const [out] = await sentTo();
    expect(await send(out!.id)).toBe("sent");
    expect(await send(out!.id)).toBe("skipped");
    expect(telephony.sent).toEqual([
      {
        from: OURS,
        to: customer,
        text: "Yes, we do.",
        statusCallbackUrl: `https://api.example/s?t=${number.tenantId}&m=${out!.id}`,
      },
    ]);
    expect((await sentTo())[0]).toMatchObject({ status: "sent", providerId: "out_1" });
    const usage = await owner.db
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.botId, number.botId), eq(usageEvents.kind, "sms")));
    expect(usage.at(-1)).toMatchObject({ quantity: 1, costMicros: 8300, metadata: { kind: "reply" } });

    const report = (status: "delivered" | "failed", id = "out_1") =>
      applyMessageStatus(app.db, number.tenantId, out!.id, { id, status, errorCode: "30003" });
    expect(await report("delivered", "someone-elses")).toBe(false);
    expect(await report("delivered")).toBe(true);
    // A late "failed" doesn't undo a delivery.
    await report("failed");
    expect((await sentTo())[0]).toMatchObject({ status: "delivered", error: null });
  });

  it("gives up on a number that can't get texts, and tries again when the provider is down", async () => {
    await text("Do you fix leaks?");
    const [out] = await sentTo();
    telephony.failing = "temporary";
    await expect(send(out!.id)).rejects.toThrow("Provider unavailable");
    expect((await sentTo())[0]).toMatchObject({ status: "queued" });

    telephony.failing = "permanent";
    expect(await send(out!.id)).toBe("failed");
    expect((await sentTo())[0]).toMatchObject({ status: "failed", error: "30006" });
  });

  it("doesn't send to a number that opted out after the text was queued", async () => {
    await text("Do you fix leaks?");
    const [out] = await sentTo();
    await owner.db
      .insert(smsOptOuts)
      .values({ tenantId: number.tenantId, botId: number.botId, number: customer });
    expect(await send(out!.id)).toBe("skipped");
    expect(telephony.sent).toEqual([]);
    expect((await sentTo())[0]).toMatchObject({ status: "failed", error: "opted_out" });
  });
});
