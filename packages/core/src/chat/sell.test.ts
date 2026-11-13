import {
  bots,
  businessProfiles,
  catalogItems,
  createDb,
  type DbHandle,
  leads,
  runMigrations,
  tenants,
  withTenant,
} from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  type ContentBlock,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
} from "@traiblazer/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChatStreamEvent, runChat } from "./engine.js";
import { MarkerFilter } from "./markers.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let owner: DbHandle;
let app: DbHandle;
let tenantId: string;
let botId: string;
/** Ids of the services, by name. */
const items: Record<string, string> = {};

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

const gatewayWith = (chat: Scripted) =>
  new LLMGateway({
    providers: [chat, new OfflineProvider()],
    routes: { chat: [{ provider: chat.id, model: "m" }], aux: [{ provider: "offline", model: "echo" }] },
  });

async function chat(model: Scripted, visitorId: string, message: string, conversationId?: string) {
  const events: ChatStreamEvent[] = [];
  for await (const e of runChat(
    { db: app.db, gateway: gatewayWith(model) },
    { tenantId, botId, visitorId, channel: "hosted", message, conversationId },
  )) {
    events.push(e);
  }
  return {
    events,
    actions: events.flatMap((e) => (e.type === "action" ? [e.action] : [])),
    reply: events.map((e) => (e.type === "text" ? e.text : "")).join(""),
    done: events.find((e) => e.type === "done") as Extract<ChatStreamEvent, { type: "done" }>,
    conversationId: (events[0] as { conversationId: string }).conversationId,
  };
}

const saying = (id: string, text: string) => new Scripted(id, () => ({ text }));

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 4 });
  const [t] = await owner.db
    .insert(tenants)
    .values({ name: "Smith Plumbing", slug: `sell-${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  tenantId = t!.id;
  const [b] = await owner.db
    .insert(bots)
    .values({ tenantId, name: "Smith bot", pack: "trades", variant: "plumbing", languages: ["en", "fr"] })
    .returning();
  botId = b!.id;
  await owner.db
    .insert(businessProfiles)
    .values({ tenantId, botId, businessName: "Smith & Sons Plumbing", phone: "(519) 555-0100" });
  const rows = await owner.db
    .insert(catalogItems)
    .values([
      { tenantId, botId, position: 0, name: "Drain cleaning", priceText: "from $120", action: "book" },
      { tenantId, botId, position: 1, name: "Water heater installation", action: "quote" },
      { tenantId, botId, position: 2, name: "Leak repair", action: "ask" },
    ])
    .returning();
  for (const row of rows) items[row.name] = row.id;
});

afterAll(async () => {
  await owner?.db.delete(tenants).where(eq(tenants.id, tenantId));
  await app?.close();
  await owner?.close();
});

describe("markers for a service's button", () => {
  it("are taken out of the text, also when split across chunks", () => {
    const filter = new MarkerFilter();
    const a = filter.push("We do that.\n[[action:quo");
    const b = filter.push("te:s2]]\n");
    expect(a.text + b.text + filter.flush()).toBe("We do that.\n");
    expect([...a.actions, ...b.actions]).toEqual(["quote:s2"]);
    expect(new MarkerFilter().push("[[action:call]]").actions).toEqual(["call"]);
  });
});

describe("a button for the service the visitor asked about", () => {
  it("tells the model each item's id and button", async () => {
    const model = saying("p1", "Yes.");
    await chat(model, "v-prompt", "What do you do?");
    const prompt = model.requests[0]!.system.map((b) => b.text).join("\n");
    expect(prompt).toContain("- [s1] Drain cleaning — price: from $120 (button: book)");
    expect(prompt).toContain("- [s2] Water heater installation (button: quote)");
    // "Ask about this" isn't a button under an answer: the visitor is already asking.
    expect(prompt).toMatch(/- \[s3\] Leak repair$/m);
    const tool = model.requests[0]!.tools!.find((t) => t.name === "request_follow_up")!;
    expect(Object.keys((tool.inputSchema as { properties: object }).properties)).toContain("item");
  });

  it("shows the item's own button, stored with the reply", async () => {
    const { actions, done, reply } = await chat(
      saying("b1", "We install tank and tankless heaters.\n[[action:quote:s2]]"),
      "v-quote",
      "Do you install water heaters?",
    );
    const button = {
      kind: "quote",
      item: { id: items["Water heater installation"], name: "Water heater installation" },
    };
    expect(actions).toEqual([button]);
    expect(done.flags.actions).toEqual([button]);
    expect(reply.trim()).toBe("We install tank and tankless heaters.");
  });

  it("asks for a booking in the chat when the business has no booking link, and opens the link when it has", async () => {
    const model = () => saying(`b-${crypto.randomUUID().slice(0, 6)}`, "From $120.\n[[action:book:s1]]");
    const item = { id: items["Drain cleaning"], name: "Drain cleaning" };
    expect((await chat(model(), "v-book1", "How much is drain cleaning?")).actions).toEqual([
      { kind: "book", item },
    ]);
    await owner.db
      .update(businessProfiles)
      .set({ bookingUrl: "https://book.example/smith" })
      .where(eq(businessProfiles.botId, botId));
    expect((await chat(model(), "v-book2", "How much is drain cleaning?")).actions).toEqual([
      { kind: "book", href: "https://book.example/smith", item },
    ]);
    await owner.db
      .update(businessProfiles)
      .set({ bookingUrl: null })
      .where(eq(businessProfiles.botId, botId));
  });

  it("drops a button the owner didn't choose, an unknown item, and a second item", async () => {
    const wrong = await chat(
      saying("d1", "Sure.\n[[action:book:s2]]\n[[action:quote:s3]]\n[[action:quote:s9]]\n[[action:pay:s1]]"),
      "v-wrong",
      "Do you fix leaks?",
    );
    expect(wrong.actions).toEqual([]);
    expect(wrong.reply.trim()).toBe("Sure.");

    const two = await chat(
      saying("d2", "Both.\n[[action:quote:s2]]\n[[action:book:s1]]\n[[action:call]]"),
      "v-two",
      "Do you do heaters and drains?",
    );
    expect(two.actions.map((a) => a.item?.name ?? a.kind)).toEqual(["Water heater installation", "call"]);
  });

  it("shows an item's button once per conversation", async () => {
    const first = await chat(
      saying("o1", "We do.\n[[action:quote:s2]]"),
      "v-once",
      "Do you install water heaters?",
    );
    expect(first.actions).toHaveLength(1);
    const again = await chat(
      saying("o2", "Tank or tankless?\n[[action:quote:s2]]"),
      "v-once",
      "I'd like a quote for Water heater installation.",
      first.conversationId,
    );
    expect(again.actions).toEqual([]);
    expect(again.reply.trim()).toBe("Tank or tankless?");
  });

  it("never shows one on an urgent problem or a request for advice", async () => {
    const urgent = await chat(
      saying("u1", "Call us now.\n[[action:quote:s2]]"),
      "v-urgent",
      "My water heater burst and the basement is flooding!",
    );
    expect(urgent.done.flags.urgency).toBe("urgent");
    expect(urgent.actions).toEqual([{ kind: "call", href: "tel:5195550100" }]);
  });
});

describe("a request that started from a service", () => {
  const request = (extra: object) => ({
    name: "request_follow_up",
    input: { name: "Alex Doe", phone: "519-555-0142", request: "Wants this done next week.", ...extra },
  });
  const leadOf = async (conversationId: string) =>
    (
      await withTenant(app.db, tenantId, (tx) =>
        tx.select().from(leads).where(eq(leads.conversationId, conversationId)),
      )
    )[0];

  it("keeps the item the assistant named", async () => {
    const model = new Scripted("r1", (_request, call) =>
      call === 1 ? { calls: [request({ kind: "quote", item: "s2" })] } : { text: "Passed on." },
    );
    const { conversationId } = await chat(
      model,
      "v-r1",
      "I'm Alex Doe, 519-555-0142. Quote for a water heater please.",
    );
    expect(await leadOf(conversationId)).toMatchObject({
      kind: "quote",
      catalogItemId: items["Water heater installation"],
      itemName: "Water heater installation",
    });
  });

  it("falls back to the item whose button was shown, for the same kind of request only", async () => {
    const first = await chat(
      saying("r2a", "We install them.\n[[action:quote:s2]]"),
      "v-r2",
      "Do you install water heaters?",
    );
    const model = new Scripted("r2b", (_request, call) =>
      call === 1 ? { calls: [request({ kind: "quote" })] } : { text: "Passed on." },
    );
    await chat(
      model,
      "v-r2",
      "I'd like a quote for Water heater installation. Alex Doe, 519-555-0142",
      first.conversationId,
    );
    expect(await leadOf(first.conversationId)).toMatchObject({ itemName: "Water heater installation" });

    const other = await chat(
      saying("r3a", "We install them.\n[[action:quote:s2]]"),
      "v-r3",
      "Do you install water heaters?",
    );
    const callback = new Scripted("r3b", (_request, call) =>
      call === 1 ? { calls: [request({ kind: "callback", item: "s77" })] } : { text: "Passed on." },
    );
    await chat(callback, "v-r3", "Actually just call me back. Alex Doe, 519-555-0142", other.conversationId);
    expect(await leadOf(other.conversationId)).toMatchObject({ catalogItemId: null, itemName: null });
  });

  it("keeps the name on the request after the service is removed", async () => {
    const model = new Scripted("r4", (_request, call) =>
      call === 1 ? { calls: [request({ kind: "booking", item: "s1" })] } : { text: "Passed on." },
    );
    const { conversationId } = await chat(model, "v-r4", "Book drain cleaning. Alex Doe, 519-555-0142");
    await owner.db.delete(catalogItems).where(eq(catalogItems.id, items["Drain cleaning"]!));
    expect(await leadOf(conversationId)).toMatchObject({ catalogItemId: null, itemName: "Drain cleaning" });
  });
});
