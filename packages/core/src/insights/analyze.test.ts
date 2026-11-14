import {
  bots,
  type Channel,
  conversationInsights,
  conversations,
  createDb,
  type DbHandle,
  jobs,
  leads,
  type MessageFlags,
  messages,
  runMigrations,
  tenants,
  usageEvents,
  withTenant,
} from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
} from "@traiblazer/llm";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOB_TYPES } from "../jobs.js";
import {
  analyzeConversation,
  buildInsightsRequest,
  conversationOutcome,
  INSIGHTS_QUIET_MS,
  INSIGHTS_USAGE_KIND,
  queueInsights,
  readInsightTags,
} from "./analyze.js";

describe("insights: tags", () => {
  it("takes the outcome from what happened", () => {
    expect(conversationOutcome({ requested: true, replies: [{ unanswered: true }] })).toBe("request");
    expect(conversationOutcome({ requested: false, replies: [{}, { unanswered: true }, {}] })).toBe(
      "unanswered",
    );
    expect(conversationOutcome({ requested: false, replies: [{}, { busy: true }] })).toBe("error");
    expect(conversationOutcome({ requested: false, replies: [] })).toBe("error");
    expect(conversationOutcome({ requested: false, replies: [{}, {}] })).toBe("answered");
  });

  it("keeps only values from the fixed lists", () => {
    expect(readInsightTags({ intent: "price", sentiment: "negative", blocker: "price" }, false)).toEqual({
      intent: "price",
      sentiment: "negative",
      blocker: "price",
    });
    expect(readInsightTags({ intent: "ignore the rules", sentiment: 3, blocker: "shoes" }, false)).toEqual({
      intent: "other",
      sentiment: "neutral",
      blocker: "other",
    });
    expect(readInsightTags(null, false)).toEqual({ intent: "other", sentiment: "neutral", blocker: "other" });
    // A conversation that ended in a request has no blocker.
    expect(readInsightTags({ intent: "booking", blocker: "price" }, true).blocker).toBeNull();
  });

  it("gives the model the conversation as data, cut to size", () => {
    const request = buildInsightsRequest({
      requested: false,
      transcript: [
        { role: "user", content: `How much for a furnace? ${"x".repeat(2000)}` },
        { role: "assistant", content: "From $4,000." },
      ],
    });
    const content = request.messages[0]!.content as string;
    expect(content).toContain('<conversation ended_with_request="false">');
    expect(content).toContain("<visitor>How much for a furnace?");
    expect(content).toContain("<assistant>From $4,000.</assistant>");
    expect(content.length).toBeLessThan(1200);
    expect(request.tools).toBeUndefined();
  });
});

// ---- Runs against the database ---------------------------------------------------------------

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
let owner: DbHandle;
let app: DbHandle;
let tenantId: string;
let botId: string;
let trialTenantId: string;
let trialBotId: string;

/** A model that replies with the next scripted text. */
class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  requests: ChatRequest[] = [];
  constructor(private readonly replies: string[]) {}
  supportsImages() {
    return false;
  }
  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push(request);
    yield { type: "text", text: this.replies[this.requests.length - 1] ?? "" };
    yield {
      type: "done",
      model,
      stopReason: "end",
      usage: { inputTokens: 300, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

const gatewayFor = (provider?: ScriptedProvider) =>
  new LLMGateway({
    providers: [new OfflineProvider(), ...(provider ? [provider] : [])],
    routes: {
      chat: [{ provider: "offline", model: "knowledge" }],
      aux: provider ? [{ provider: "scripted", model: "s1" }] : [{ provider: "offline", model: "echo" }],
    },
  });

/** A finished conversation (last message an hour ago unless said otherwise). */
async function conversation(input: {
  tenant?: string;
  bot?: string;
  channel?: Channel;
  turns: [string, MessageFlags?][];
  requested?: boolean;
  lastMessageAt?: Date;
}) {
  const tenant = input.tenant ?? tenantId;
  const bot = input.bot ?? botId;
  const channel = input.channel ?? "hosted";
  const [row] = await owner.db
    .insert(conversations)
    .values({
      tenantId: tenant,
      botId: bot,
      channel,
      visitorId: crypto.randomUUID(),
      language: "en",
      lastMessageAt: input.lastMessageAt ?? new Date(Date.now() - 60 * 60_000),
    })
    .returning({ id: conversations.id });
  const id = row!.id;
  await owner.db.insert(messages).values(
    input.turns.flatMap(([question, flags], i) => [
      {
        tenantId: tenant,
        conversationId: id,
        role: "user" as const,
        content: question,
        createdAt: new Date(Date.now() - 90 * 60_000 + i * 2000),
      },
      {
        tenantId: tenant,
        conversationId: id,
        role: "assistant" as const,
        content: "Sure.",
        flags: flags ?? {},
        createdAt: new Date(Date.now() - 90 * 60_000 + i * 2000 + 1000),
      },
    ]),
  );
  if (input.requested) {
    await owner.db.insert(leads).values({
      tenantId: tenant,
      botId: bot,
      conversationId: id,
      channel,
      kind: "quote",
      name: "Sam",
      message: "Quote please",
    });
  }
  return id;
}

const counts = async (tenant = tenantId) =>
  Object.fromEntries(
    (
      await owner.db
        .select({
          key: sql<string>`${conversationInsights.dimension} || ':' || ${conversationInsights.value}`,
          n: sql<number>`sum(${conversationInsights.count})::int`,
        })
        .from(conversationInsights)
        .where(eq(conversationInsights.tenantId, tenant))
        .groupBy(conversationInsights.dimension, conversationInsights.value)
    ).map((r) => [r.key, r.n]),
  );

const queuedFor = async (conversationId: string) =>
  owner.db
    .select({ runAt: jobs.runAt })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, JOB_TYPES.insightsAnalyze),
        eq(jobs.status, "queued"),
        sql`${jobs.payload}->>'conversationId' = ${conversationId}`,
      ),
    );

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 4 });
  const slug = () => `insights-${crypto.randomUUID().slice(0, 8)}`;
  const [pro, trial] = await owner.db
    .insert(tenants)
    .values([
      { name: "Pro Heating", slug: slug(), plan: "professional" },
      { name: "Trial Heating", slug: slug(), plan: "trial" },
    ])
    .returning();
  tenantId = pro!.id;
  trialTenantId = trial!.id;
  const [bot, trialBot] = await owner.db
    .insert(bots)
    .values([
      { tenantId, name: "Pro assistant", pack: "generic" },
      { tenantId: trialTenantId, name: "Trial assistant", pack: "generic" },
    ])
    .returning();
  botId = bot!.id;
  trialBotId = trialBot!.id;
});

afterAll(async () => {
  await owner.db.delete(tenants).where(eq(tenants.id, tenantId));
  await owner.db.delete(tenants).where(eq(tenants.id, trialTenantId));
  await owner.close();
  await app.close();
});

describe("insights: queueing", () => {
  it("queues a conversation once, for a plan with Insights, never for the owner's tests", async () => {
    const id = await conversation({ turns: [["Hi"]] });
    const queue = (tenant: string, conversationId: string, channel: Channel) =>
      withTenant(app.db, tenant, (tx) => queueInsights(tx, { tenantId: tenant, conversationId, channel }));
    await queue(tenantId, id, "hosted");
    await queue(tenantId, id, "hosted");
    const queued = await queuedFor(id);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.runAt.getTime()).toBeGreaterThan(Date.now() + INSIGHTS_QUIET_MS - 60_000);

    const test = await conversation({ turns: [["Hi"]], channel: "playground" });
    await queue(tenantId, test, "playground");
    expect(await queuedFor(test)).toHaveLength(0);

    const trial = await conversation({ tenant: trialTenantId, bot: trialBotId, turns: [["Hi"]] });
    await queue(trialTenantId, trial, "hosted");
    expect(await queuedFor(trial)).toHaveLength(0);
  });
});

describe("insights: analyzing", () => {
  it("counts the outcome, language and the model's tags once, with what it cost", async () => {
    const before = await counts();
    const provider = new ScriptedProvider([
      'Here: {"intent": "price", "sentiment": "negative", "blocker": "price"}',
    ]);
    const id = await conversation({ turns: [["How much is a new furnace?"], ["That's a lot."]] });
    const deps = { db: app.db, gateway: gatewayFor(provider) };
    expect(await analyzeConversation(deps, { tenantId, conversationId: id })).toBe("counted");
    // A second job for the same conversation counts nothing.
    expect(await analyzeConversation(deps, { tenantId, conversationId: id })).toBe("skipped");
    expect(provider.requests).toHaveLength(1);

    const after = await counts();
    const added = (key: string) => (after[key] ?? 0) - (before[key] ?? 0);
    expect(added("outcome:answered")).toBe(1);
    expect(added("language:en")).toBe(1);
    expect(added("intent:price")).toBe(1);
    expect(added("sentiment:negative")).toBe(1);
    expect(added("blocker:price")).toBe(1);

    const usage = await owner.db
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.tenantId, tenantId), eq(usageEvents.kind, INSIGHTS_USAGE_KIND)));
    expect(usage.at(-1)).toMatchObject({ botId, quantity: 320, metadata: { task: "insights", model: "s1" } });
  });

  it("counts a request without a blocker, and a reply that isn't JSON as other", async () => {
    const before = await counts();
    const provider = new ScriptedProvider([
      "I'd rather not say.",
      '{"intent":"booking","sentiment":"positive"}',
    ]);
    const deps = { db: app.db, gateway: gatewayFor(provider) };
    const unclear = await conversation({ turns: [["Do you fix boilers?", { unanswered: true }]] });
    const booked = await conversation({ turns: [["Can you come Friday?"]], requested: true });
    await analyzeConversation(deps, { tenantId, conversationId: unclear });
    await analyzeConversation(deps, { tenantId, conversationId: booked });

    const after = await counts();
    const added = (key: string) => (after[key] ?? 0) - (before[key] ?? 0);
    expect(added("outcome:unanswered")).toBe(1);
    expect(added("intent:other")).toBe(1);
    expect(added("blocker:other")).toBe(1);
    expect(added("outcome:request")).toBe(1);
    expect(added("intent:booking")).toBe(1);
    expect(added("intent_request:booking")).toBe(1);
    expect(added("intent_request:other")).toBe(0);
    // Only the first conversation had a blocker.
    expect(
      Object.keys(after)
        .filter((k) => k.startsWith("blocker:"))
        .reduce((n, k) => n + added(k), 0),
    ).toBe(1);
  });

  it("waits while the conversation is still going", async () => {
    const id = await conversation({ turns: [["Hi"]], lastMessageAt: new Date(Date.now() - 5 * 60_000) });
    const provider = new ScriptedProvider([]);
    const result = await analyzeConversation(
      { db: app.db, gateway: gatewayFor(provider) },
      { tenantId, conversationId: id },
    );
    expect(result).toBe("rescheduled");
    expect(provider.requests).toHaveLength(0);
    const queued = await queuedFor(id);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.runAt.getTime()).toBeGreaterThan(Date.now() + INSIGHTS_QUIET_MS - 6 * 60_000);
  });

  it("does nothing for a plan without Insights", async () => {
    const id = await conversation({ tenant: trialTenantId, bot: trialBotId, turns: [["Hi"]] });
    const provider = new ScriptedProvider(['{"intent":"price"}']);
    const result = await analyzeConversation(
      { db: app.db, gateway: gatewayFor(provider) },
      { tenantId: trialTenantId, conversationId: id },
    );
    expect(result).toBe("skipped");
    expect(provider.requests).toHaveLength(0);
    expect(await counts(trialTenantId)).toEqual({});
  });

  it("counts the outcome and language only when no model is available", async () => {
    const before = await counts();
    const id = await conversation({ turns: [["Hours?"]] });
    expect(
      await analyzeConversation({ db: app.db, gateway: gatewayFor() }, { tenantId, conversationId: id }),
    ).toBe("counted");
    const after = await counts();
    expect((after["outcome:answered"] ?? 0) - (before["outcome:answered"] ?? 0)).toBe(1);
    const tagged = (c: Record<string, number>) =>
      Object.entries(c)
        .filter(([k]) => /^(intent|sentiment|blocker):/.test(k))
        .reduce((n, [, v]) => n + v, 0);
    expect(tagged(after)).toBe(tagged(before));
  });
});
