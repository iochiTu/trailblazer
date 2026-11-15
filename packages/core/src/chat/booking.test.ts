import { randomBytes } from "node:crypto";
import {
  bookings,
  botAddons,
  bots,
  businessProfiles,
  createDb,
  type DbHandle,
  integrationConnections,
  leads,
  runMigrations,
  tenants,
  withTenant,
} from "@traiblazer/db";
import { type IntegrationsConfig, open, seal, sealContext } from "@traiblazer/integrations";
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type ChatStreamEvent, runChat } from "./engine.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let owner: DbHandle;
let app: DbHandle;
let tenantId: string;
let botId: string;

const PROVIDER = "google-calendar";
const key = randomBytes(32);
const integrations: IntegrationsConfig = {
  secretKey: key,
  platform: { google: { clientId: "gid", clientSecret: "gsecret" } },
};
// Monday 16 November 2026, 08:00 in Toronto.
const NOW = new Date("2026-11-16T13:00:00Z");
const now = () => NOW;
const weekday = { open: "09:00", close: "17:00" };

interface ScriptedTurn {
  text?: string;
  calls?: { name: string; input: unknown }[];
}

/** A model that calls tools: each request gets the next turn the script returns for it. */
class ToolProvider implements LLMProvider {
  readonly id = "tools";
  requests: ChatRequest[] = [];
  constructor(private readonly script: (request: ChatRequest, call: number) => ScriptedTurn) {}
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

const gatewayFor = (provider: ToolProvider) =>
  new LLMGateway({
    providers: [provider, new OfflineProvider()],
    routes: { chat: [{ provider: "tools", model: "t1" }], aux: [{ provider: "offline", model: "echo" }] },
  });

const results = (request: ChatRequest): ToolResultBlock[] => {
  const latest = request.messages.at(-1)!.content;
  return typeof latest === "string" ? [] : latest.filter((b) => b.type === "tool_result");
};

async function collect(gen: AsyncGenerator<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return {
    conversationId: (events[0] as { conversationId: string }).conversationId,
    done: events.find((e) => e.type === "done") as Extract<ChatStreamEvent, { type: "done" }>,
  };
}

/** A fake Google: Tuesday 10:00–11:30 Toronto is busy; tokens refresh unless told to refuse. */
function fakeGoogle(options: { refuseRefresh?: boolean } = {}) {
  const calls: { url: string; body: string }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, body });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
    if (url.includes("oauth2.googleapis.com/token")) {
      return options.refuseRefresh
        ? json(400, { error: "invalid_grant" })
        : json(200, { access_token: "fresh-token", expires_in: 3600 });
    }
    if (url.includes("/freeBusy")) {
      return json(200, {
        calendars: { primary: { busy: [{ start: "2026-11-17T15:00:00Z", end: "2026-11-17T16:30:00Z" }] } },
      });
    }
    if (url.includes("/calendars/primary/events")) {
      return json(200, { id: JSON.parse(body).id, htmlLink: "https://calendar.google.com/event?eid=1" });
    }
    return new Response("no rule", { status: 599 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

async function connect(credentials: Record<string, string>, status: "connected" | "error" = "connected") {
  await owner.db.delete(integrationConnections).where(eq(integrationConnections.botId, botId));
  await owner.db.insert(integrationConnections).values({
    tenantId,
    botId,
    provider: PROVIDER,
    status,
    accountName: "owner@maple.example",
    credentials: seal(key, credentials, sealContext(tenantId, botId, PROVIDER)),
  });
}

const fresh = { accessToken: "at", refreshToken: "rt", expiresAt: String(NOW.getTime() + 3_600_000) };

/** A conversation where the visitor asks for Tuesday, picks 9:00, and gives their name and number. */
function bookingScript(start = "2026-11-17T09:00") {
  return new ToolProvider((request, call) => {
    if (call === 1) return { calls: [{ name: "find_open_times", input: { from: "2026-11-17" } }] };
    if (call === 2) {
      return {
        calls: [
          {
            name: "book_appointment",
            input: {
              start,
              name: "Jean Tremblay",
              phone: "807-555-0142",
              request: "Furnace check",
              details: { location: "Thunder Bay", equipment: "gas furnace, 12 years" },
            },
          },
        ],
      };
    }
    return { text: results(request)[0]?.isError ? "Sorry." : "Booked!" };
  });
}

const chat = (
  provider: ToolProvider,
  fetchFn: typeof fetch,
  channel: "hosted" | "playground" = "hosted",
  visitorId = `v-${crypto.randomUUID()}`,
) =>
  collect(
    runChat(
      { db: app.db, gateway: gatewayFor(provider), now, integrations, integrationsFetch: fetchFn },
      {
        tenantId,
        botId,
        visitorId,
        channel,
        message: "Can someone check my furnace Tuesday? I'm Jean Tremblay, 807-555-0142, in Thunder Bay.",
      },
    ),
  );

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 4 });
  const suffix = crypto.randomUUID().slice(0, 8);
  const [t] = await owner.db
    .insert(tenants)
    .values({ name: "Maple Heating", slug: `maple-${suffix}`, ownerLanguage: "en" })
    .returning();
  tenantId = t!.id;
  const [b] = await owner.db.insert(bots).values({ tenantId, name: "Maple", pack: "trades" }).returning();
  botId = b!.id;
  await owner.db.insert(businessProfiles).values({
    tenantId,
    botId,
    businessName: "Maple Heating",
    timezone: "America/Toronto",
    hours: { mon: [weekday], tue: [weekday], wed: [weekday], thu: [weekday], fri: [weekday] },
  });
  await owner.db.insert(botAddons).values({
    tenantId,
    botId,
    addonId: PROVIDER,
    config: { duration: "60", notice: "1", daysAhead: "14" },
  });
});

beforeEach(async () => {
  await owner.db.delete(bookings).where(eq(bookings.botId, botId));
  await owner.db.delete(leads).where(eq(leads.botId, botId));
  await connect(fresh);
});

afterAll(async () => {
  await owner?.db.delete(tenants).where(eq(tenants.id, tenantId));
  await app?.close();
  await owner?.close();
});

describe("booking in the business's calendar", () => {
  it("offers open times from the hours and the calendar, then books the chosen one", async () => {
    const google = fakeGoogle();
    const provider = bookingScript();
    const { conversationId, done } = await chat(provider, google.fetch);

    // The tools are offered, and the open times leave out what the calendar has busy.
    expect(provider.requests[0]!.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(["find_open_times", "book_appointment", "request_follow_up"]),
    );
    const offered = results(provider.requests[1]!)[0]!.content;
    expect(offered).toContain("2026-11-17T09:00");
    expect(offered).not.toContain("2026-11-17T10:00");
    expect(offered).toContain("(America/Toronto, 60 minutes each)");
    expect(results(provider.requests[2]!)[0]).not.toHaveProperty("isError");
    expect(results(provider.requests[2]!)[0]!.content).toContain("Booked for Tuesday, November 17 at 09:00");
    expect(done.flags.tools).toEqual(["find_open_times", "book_appointment"]);

    // The appointment went into the calendar at 9:00 Toronto (14:00 UTC), with the visitor's details.
    const created = google.calls.filter((c) => c.url.includes("/events"));
    expect(created).toHaveLength(1);
    const event = JSON.parse(created[0]!.body);
    expect(event.start).toEqual({ dateTime: "2026-11-17T14:00:00.000Z", timeZone: "America/Toronto" });
    expect(event.end.dateTime).toBe("2026-11-17T15:00:00.000Z");
    expect(event.summary).toBe("Jean Tremblay: Furnace check");
    expect(event.description).toContain("807-555-0142");
    expect(event.description).toContain("Equipment: gas furnace, 12 years");

    // A booking request for staff, tied to the booking row.
    const [booking] = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(bookings).where(eq(bookings.conversationId, conversationId)),
    );
    expect(booking).toMatchObject({
      status: "booked",
      provider: PROVIDER,
      startsAt: new Date("2026-11-17T14:00:00Z"),
      externalUrl: "https://calendar.google.com/event?eid=1",
    });
    const [lead] = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(leads).where(eq(leads.id, booking!.leadId!)),
    );
    expect(lead).toMatchObject({
      kind: "booking",
      name: "Jean Tremblay",
      phone: "807-555-0142",
      message: "Furnace check",
      bestTime: "Tuesday, November 17, 2026, 9:00 a.m. – 10:00 a.m.",
      details: { location: "Thunder Bay", equipment: "gas furnace, 12 years" },
    });
  });

  it("refuses a time that isn't open, and a second booking in the same conversation", async () => {
    const google = fakeGoogle();
    // 10:00 is busy in the calendar.
    const busy = bookingScript("2026-11-17T10:00");
    await chat(busy, google.fetch);
    expect(results(busy.requests[2]!)[0]).toMatchObject({ isError: true });
    expect(results(busy.requests[2]!)[0]!.content).toContain("isn't open");
    // A made-up format is refused before the calendar is asked.
    const madeUp = bookingScript("Tuesday at nine");
    await chat(madeUp, google.fetch);
    expect(results(madeUp.requests[2]!)[0]!.content).toContain("isn't a time from find_open_times");
    expect(google.calls.some((c) => c.url.includes("/events"))).toBe(false);

    const first = bookingScript();
    const { conversationId } = await chat(first, google.fetch, "hosted", "same");
    const again = new ToolProvider((request, call) =>
      call === 1
        ? {
            calls: [
              {
                name: "book_appointment",
                input: { start: "2026-11-17T13:00", name: "Jean", phone: "807-555-0142", request: "Another" },
              },
            ],
          }
        : { text: results(request)[0]?.content ?? "" },
    );
    await collect(
      runChat(
        { db: app.db, gateway: gatewayFor(again), now, integrations, integrationsFetch: google.fetch },
        {
          tenantId,
          botId,
          conversationId,
          visitorId: "same",
          channel: "hosted",
          message: "Actually also book 1 pm",
        },
      ),
    );
    expect(results(again.requests[1]!)[0]).toMatchObject({ isError: true });
    expect(results(again.requests[1]!)[0]!.content).toContain("already booked in this conversation");
  });

  it("never takes the same start twice", async () => {
    const google = fakeGoogle();
    await chat(bookingScript(), google.fetch);
    const second = bookingScript();
    await chat(second, google.fetch);
    // The fake calendar still says 9:00 is free; our own booking holds it.
    expect(results(second.requests[2]!)[0]!.content).toContain("was just taken");
    const rows = await withTenant(app.db, tenantId, (tx) => tx.select().from(bookings));
    expect(rows.filter((r) => r.status === "booked")).toHaveLength(1);
  });

  it("books nothing from the owner's test chat", async () => {
    const google = fakeGoogle();
    const provider = bookingScript();
    await chat(provider, google.fetch, "playground");
    expect(results(provider.requests[2]!)[0]!.content).toContain("Test chat");
    expect(google.calls.some((c) => c.url.includes("/events"))).toBe(false);
    expect(await withTenant(app.db, tenantId, (tx) => tx.select().from(bookings))).toHaveLength(0);
    expect(await withTenant(app.db, tenantId, (tx) => tx.select().from(leads))).toHaveLength(0);
  });

  it("refreshes the token and saves it sealed", async () => {
    await connect({ ...fresh, expiresAt: "0" });
    const google = fakeGoogle();
    await chat(bookingScript(), google.fetch);
    const [row] = await owner.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.botId, botId));
    expect(
      open<Record<string, string>>(key, row!.credentials, sealContext(tenantId, botId, PROVIDER)),
    ).toMatchObject({
      accessToken: "fresh-token",
      refreshToken: "rt",
    });
    expect(row!.lastSuccessAt).not.toBeNull();
  });

  it("flags the connection and falls back to a request when Google refuses it", async () => {
    await connect({ ...fresh, expiresAt: "0" });
    const provider = bookingScript();
    await chat(provider, fakeGoogle({ refuseRefresh: true }).fetch);
    expect(results(provider.requests[1]!)[0]).toMatchObject({ isError: true });
    expect(results(provider.requests[1]!)[0]!.content).toContain("request_follow_up");
    const [row] = await owner.db
      .select({ status: integrationConnections.status })
      .from(integrationConnections)
      .where(eq(integrationConnections.botId, botId));
    expect(row!.status).toBe("error");

    // While flagged, the assistant isn't offered the booking tools at all.
    const next = new ToolProvider(() => ({ text: "Hi" }));
    await chat(next, fakeGoogle().fetch);
    expect(next.requests[0]!.tools?.map((t) => t.name)).not.toContain("find_open_times");
  });

  it("offers no booking tools when the add-on is off", async () => {
    await owner.db
      .update(botAddons)
      .set({ enabled: false })
      .where(and(eq(botAddons.botId, botId), eq(botAddons.addonId, PROVIDER)));
    const provider = new ToolProvider(() => ({ text: "Hi" }));
    await chat(provider, fakeGoogle().fetch);
    expect(provider.requests[0]!.tools?.map((t) => t.name)).not.toContain("book_appointment");
    await owner.db
      .update(botAddons)
      .set({ enabled: true })
      .where(and(eq(botAddons.botId, botId), eq(botAddons.addonId, PROVIDER)));
  });
});
