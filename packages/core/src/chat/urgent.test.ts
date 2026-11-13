import {
  botAddons,
  bots,
  businessProfiles,
  createDb,
  type DbHandle,
  jobs,
  leads,
  memberships,
  messages,
  runMigrations,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  type ContentBlock,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
  type ToolResultBlock,
} from "@traiblazer/llm";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimNextJob, JOB_PRIORITY, JOB_TYPES } from "../jobs.js";
import { runUrgentAlert } from "../requests/urgent-alert.js";
import { type ChatImage, type ChatStreamEvent, runChat } from "./engine.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let owner: DbHandle;
let app: DbHandle;
let tenantId: string;
let botId: string;
let ownerEmail: string;

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const image = (name: string): ChatImage => ({
  name,
  contentType: "image/png",
  dataBase64: PIXEL,
  sizeBytes: 70,
  sha256: "test",
});

interface Turn {
  text?: string;
  calls?: { name: string; input: unknown }[];
}

/** A scripted model: each request gets the next turn; it can call tools. */
class Scripted implements LLMProvider {
  requests: ChatRequest[] = [];
  constructor(
    readonly id: string,
    private readonly script: (request: ChatRequest, call: number) => Turn,
  ) {}
  supportsImages() {
    return false;
  }
  supportsTools() {
    return true;
  }
  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push({ ...request, messages: [...request.messages] });
    const call = this.requests.length;
    const turn = this.script(request, call);
    if (turn.text) yield { type: "text", text: turn.text };
    const content: ContentBlock[] = [
      ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
      ...(turn.calls ?? []).map((c, i) => ({ type: "tool_call" as const, id: `call_${call}_${i}`, ...c })),
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

const gatewayWith = (chat: Scripted, aux?: Scripted) =>
  new LLMGateway({
    providers: [chat, ...(aux ? [aux] : []), new OfflineProvider()],
    routes: {
      chat: [{ provider: chat.id, model: "m" }],
      aux: [aux ? { provider: aux.id, model: "a" } : { provider: "offline", model: "echo" }],
    },
  });

const toolResults = (request: ChatRequest): ToolResultBlock[] => {
  const latest = request.messages.at(-1)!.content;
  return typeof latest === "string" ? [] : latest.filter((b) => b.type === "tool_result");
};

async function collect(gen: AsyncGenerator<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return {
    events,
    done: events.find((e) => e.type === "done") as Extract<ChatStreamEvent, { type: "done" }>,
    conversationId: (events[0] as { conversationId: string }).conversationId,
  };
}

const chat = (gateway: LLMGateway, visitorId: string, message: string, extra: object = {}) =>
  collect(
    runChat({ db: app.db, gateway }, { tenantId, botId, visitorId, channel: "hosted", message, ...extra }),
  );

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 4 });
  const suffix = crypto.randomUUID().slice(0, 8);
  const [t] = await owner.db
    .insert(tenants)
    .values({ name: "Smith Plumbing", slug: `smith-${suffix}` })
    .returning();
  tenantId = t!.id;
  ownerEmail = `owner-${suffix}@smith.example`;
  const [u] = await owner.db
    .insert(users)
    .values({ email: ownerEmail, name: "Sam Smith", passwordHash: "x" })
    .returning();
  await owner.db.insert(memberships).values({ tenantId, userId: u!.id, role: "owner" });
  const [b] = await owner.db
    .insert(bots)
    .values({ tenantId, name: "Smith bot", pack: "trades", variant: "plumbing", languages: ["en", "fr"] })
    .returning();
  botId = b!.id;
  await owner.db.insert(businessProfiles).values({
    tenantId,
    botId,
    businessName: "Smith & Sons Plumbing",
    phone: "(519) 555-0100",
    bookingUrl: "https://book.example/smith",
    serviceTowns: ["Guelph", "Fergus"],
    servicePostalPrefixes: ["N1H"],
  });
});

afterAll(async () => {
  await owner?.db.delete(tenants).where(eq(tenants.id, tenantId));
  await owner?.db.delete(users).where(eq(users.email, ownerEmail));
  await app?.close();
  await owner?.close();
});

describe("triage in the chat engine", () => {
  it("flags an urgent problem by the industry's words, shows the phone at once and adds a Call button", async () => {
    const model = new Scripted("m1", () => ({ text: "Please call us right away." }));
    const { events, done } = await chat(
      gatewayWith(model),
      "v-burst",
      "There's a burst pipe in my basement!",
    );
    // Shown right after the conversation starts, before the reply.
    expect(events[1]).toEqual({ type: "urgent", level: "urgent", phone: "(519) 555-0100" });
    expect(events.filter((e) => e.type === "action")).toEqual([
      { type: "action", action: { kind: "call", href: "tel:5195550100" } },
    ]);
    expect(done.flags).toMatchObject({
      urgency: "urgent",
      actions: [{ kind: "call", href: "tel:5195550100" }],
    });
    expect(model.requests[0]!.system.at(-1)!.text).toContain("describes an urgent problem");
  });

  it("lets the auxiliary model raise it in any language", async () => {
    const aux = new Scripted("aux", (request) => ({
      text: JSON.stringify(request.messages).includes("gas")
        ? "EN: gas smell at home\nFR: odeur de gaz\nTYPE: danger"
        : "EN: hello\nFR: bonjour\nTYPE: routine",
    }));
    const model = new Scripted("m2", () => ({ text: "Salga de la casa y llame al 911." }));
    const gateway = gatewayWith(model, aux);
    // A first message: the model's triage runs alongside the answer, so the banner comes after it.
    const first = await chat(gateway, "v-gas", "Huele mucho a gas en mi casa");
    expect(first.events.filter((e) => e.type === "urgent")).toEqual([
      { type: "urgent", level: "danger", phone: "(519) 555-0100" },
    ]);
    expect(first.done.flags.urgency).toBe("danger");

    // A follow-up: the same call also rewrites the search, so its triage reaches the answer's prompt.
    const greeting = await chat(gateway, "v-gas2", "Hola");
    const followUp = await chat(gateway, "v-gas2", "Ahora huele a gas", {
      conversationId: greeting.conversationId,
    });
    expect(followUp.events[1]).toEqual({ type: "urgent", level: "danger", phone: "(519) 555-0100" });
    expect(model.requests.at(-1)!.system.at(-1)!.text).toContain("possible danger to life");
  });

  it("records advice requests and routine questions without alarms", async () => {
    const aux = new Scripted("aux2", () => ({ text: "EN: furnace noise safe\nFR: x\nTYPE: advice" }));
    const model = new Scripted("m3", () => ({ text: "I can't judge that here; we can book a visit." }));
    const advice = await chat(
      gatewayWith(model, aux),
      "v-advice",
      "Is it safe to keep running my furnace when it bangs?",
    );
    expect(advice.done.flags).toMatchObject({ advice: true });
    expect(advice.done.flags.urgency).toBeUndefined();
    expect(advice.events.some((e) => e.type === "urgent")).toBe(false);

    const routine = await chat(
      gatewayWith(new Scripted("m4", () => ({ text: "From $120." }))),
      "v-routine",
      "How much is drain cleaning?",
    );
    expect(routine.done.flags.urgency).toBeUndefined();
    expect(routine.events.some((e) => e.type === "urgent" || e.type === "action")).toBe(false);
  });

  it("only shows buttons the business has the number or link for", async () => {
    const model = new Scripted("m5", () => ({
      text: "Book online here.\n[[action:book]]\n[[action:book]]\n[[action:shop]]",
    }));
    const { events, done } = await chat(gatewayWith(model), "v-book", "Can I book a visit?");
    expect(events.filter((e) => e.type === "action")).toEqual([
      { type: "action", action: { kind: "book", href: "https://book.example/smith" } },
    ]);
    expect(done.flags.actions).toEqual([{ kind: "book", href: "https://book.example/smith" }]);
    const [stored] = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(messages).where(eq(messages.id, done.messageId)),
    );
    expect(stored!.content).toBe("Book online here.");
  });
});

describe("urgent requests", () => {
  it("saves the industry's details and the visitor's photos, and queues the alert ahead of other jobs", async () => {
    const model = new Scripted("m6", (request, call) =>
      call === 1
        ? {
            calls: [
              {
                name: "request_follow_up",
                input: {
                  kind: "callback",
                  name: "Alex Doe",
                  phone: "519-555-0142",
                  request: "Water heater leaking all over the basement floor.",
                  details: {
                    location: "Guelph N1H 2B3",
                    equipment: "Gas water heater, 12 years",
                    bogus: "x",
                  },
                },
              },
            ],
          }
        : { text: toolResults(request)[0]!.content },
    );
    const { done, conversationId } = await chat(
      gatewayWith(model),
      "v-heater",
      "Water everywhere from my water heater! I'm Alex Doe, 519-555-0142",
      { images: [image("leak.png")] },
    );
    expect(done.flags.urgency).toBe("urgent");
    // The tool's schema carries the industry's fields.
    const tool = model.requests[0]!.tools!.find((t) => t.name === "request_follow_up")!;
    expect(
      Object.keys(
        (tool.inputSchema as { properties: { details: { properties: object } } }).properties.details
          .properties,
      ),
    ).toEqual(["location", "property", "equipment"]);

    const [lead] = await owner.db.select().from(leads).where(eq(leads.conversationId, conversationId));
    expect(lead).toMatchObject({
      urgent: true,
      details: { location: "Guelph N1H 2B3", equipment: "Gas water heater, 12 years" },
    });
    expect(lead!.attachmentIds).toHaveLength(1);
    expect(toolResults(model.requests[1]!)[0]!.content).toContain("marked urgent");

    const alerts = await owner.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, JOB_TYPES.urgentAlert)));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ priority: JOB_PRIORITY.urgent, payload: { botId, leadId: lead!.id } });
  });

  it("emails the owners, or the notification address when that add-on is on", async () => {
    const [lead] = await owner.db
      .update(leads)
      .set({ itemName: "Water heater installation" })
      .where(eq(leads.botId, botId))
      .returning();
    const sent: { to: string[]; subject: string; text: string }[] = [];
    const mailer = { send: async (m: (typeof sent)[number]) => void sent.push(m) };
    const deps = { db: app.db, mailer, adminUrl: "https://admin.example" };

    expect(await runUrgentAlert(deps, tenantId, { botId, leadId: lead!.id })).toBe("done");
    expect(sent[0]!.to).toEqual([ownerEmail]);
    expect(sent[0]!.subject).toBe("URGENT: Alex Doe needs help now (Smith & Sons Plumbing)");
    expect(sent[0]!.text).toContain("Phone: 519-555-0142");
    expect(sent[0]!.text).toContain("About: Water heater installation");
    expect(sent[0]!.text).toContain("Address or town: Guelph N1H 2B3");
    expect(sent[0]!.text).toContain("Equipment: Gas water heater, 12 years");
    expect(sent[0]!.text).toContain("1 photo attached");
    expect(sent[0]!.text).toContain(`https://admin.example/t/${tenantId}/bots/${botId}?tab=requests`);

    await withTenant(app.db, tenantId, (tx) =>
      tx
        .insert(botAddons)
        .values({ tenantId, botId, addonId: "email-notifications", config: { email: "Desk@Smith.example" } }),
    );
    await runUrgentAlert(deps, tenantId, { botId, leadId: lead!.id });
    expect(sent[1]!.to).toEqual(["desk@smith.example"]);

    // Not urgent (or from the owner's test chat): nothing is sent.
    await owner.db.update(leads).set({ urgent: false }).where(eq(leads.id, lead!.id));
    expect(await runUrgentAlert(deps, tenantId, { botId, leadId: lead!.id })).toBe("skipped");
    expect(sent).toHaveLength(2);
  });

  it("runs urgent jobs first", async () => {
    await owner.db.delete(jobs).where(eq(jobs.tenantId, tenantId));
    const past = new Date(Date.now() - 60_000);
    await owner.db.insert(jobs).values({
      tenantId,
      type: JOB_TYPES.sourceSync,
      payload: {},
      runAt: new Date(past.getTime() - 60_000),
    });
    const [urgent] = await owner.db
      .insert(jobs)
      .values({
        tenantId,
        type: JOB_TYPES.urgentAlert,
        payload: {},
        runAt: past,
        priority: JOB_PRIORITY.urgent,
      })
      .returning();
    const claimed = await claimNextJob(owner.db, "test-worker");
    expect(claimed?.id).toBe(urgent!.id);
    await owner.db.delete(jobs).where(eq(jobs.tenantId, tenantId));
  });
});

describe("service-area check in the chat engine", () => {
  it("answers from the business's own towns and postal codes", async () => {
    const model = new Scripted("m7", (request, call) =>
      call === 1
        ? { calls: [{ name: "check_service_area", input: { location: "Kitchener, N2L 3G1" } }] }
        : { text: toolResults(request)[0]!.content },
    );
    await chat(gatewayWith(model), "v-area", "Do you come to Kitchener, N2L 3G1?");
    expect(model.requests[0]!.tools!.map((t) => t.name)).toContain("check_service_area");
    expect(toolResults(model.requests[1]!)[0]!.content).toContain(
      "isn't in the business's service area list",
    );

    const inArea = new Scripted("m8", (request, call) =>
      call === 1
        ? { calls: [{ name: "check_service_area", input: { location: "fergus" } }] }
        : { text: toolResults(request)[0]!.content },
    );
    await chat(gatewayWith(inArea), "v-area2", "Fergus?");
    expect(toolResults(inArea.requests[1]!)[0]!.content).toBe(
      '"fergus" is in the service area (listed: Fergus).',
    );
  });
});
