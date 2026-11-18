import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, type DbHandle, runMigrations, tenants, users } from "@traiblazer/db";
import { createGatewayFromEnv, LLMGateway, type LLMProvider } from "@traiblazer/llm";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { periodKey } from "./lib/chat-guard.js";
import { type Limiter, MemoryLimiter, RedisLimiter } from "./lib/limiter.js";
import { PlatformConfig } from "./lib/platform.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const PUBLIC = "http://chat.test.local";

let appDb: DbHandle;
let ownerDb: DbHandle;
let app: FastifyInstance;
let cookie: string;
let tenantId: string;
let botId: string;
let publicKey: string;
const emails: string[] = [];
const tenantIds: string[] = [];

const config = loadConfig({
  NODE_ENV: "test",
  AUTH_RATE_LIMIT_PER_MIN: "1000",
  CHAT_RATE_LIMIT_PER_MIN: "1000",
  CONVERSATION_MAX_QUESTIONS: "3",
  PUBLIC_URL: PUBLIC,
} as NodeJS.ProcessEnv);

async function makeApp(overrides: { limiter?: Limiter; gateway?: LLMGateway; config?: typeof config } = {}) {
  return buildApp({
    db: appDb.db,
    config: overrides.config ?? config,
    gateway: overrides.gateway ?? createGatewayFromEnv({}).gateway,
    limiter: overrides.limiter,
    chatDistDir: await mkdtemp(path.join(tmpdir(), "tb-chat-")),
  });
}

async function ask(
  target: FastifyInstance,
  message: string,
  opts: { visitorId?: string; conversationId?: string | null } = {},
) {
  const res = await target.inject({
    method: "POST",
    url: "/v1/public/chat",
    headers: { origin: PUBLIC },
    payload: {
      publicKey,
      visitorId: opts.visitorId ?? "visitor-aaaa",
      conversationId: opts.conversationId ?? null,
      message,
      channel: "hosted",
    },
  });
  const events =
    res.statusCode === 200
      ? res.body
          .split("\n\n")
          .filter((f) => f.startsWith("data:"))
          .map((f) => JSON.parse(f.slice(5)) as { type: string; [k: string]: unknown })
      : [];
  return { res, events, conversationId: events[0]?.conversationId as string | undefined };
}

const setLimits = (body: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/v1/tenants/${tenantId}/limits`, headers: { cookie }, payload: body });
const usage = async () =>
  (await app.inject({ method: "GET", url: `/v1/tenants/${tenantId}/usage`, headers: { cookie } })).json();

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  app = await makeApp();

  const email = `limits-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const signup = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name: "Owner" },
  });
  cookie = `tb_session=${signup.cookies.find((c) => c.name === "tb_session")!.value}`;
  tenantId = (
    await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: { cookie },
      payload: { name: "Pine Café" },
    })
  ).json().tenant.id;
  tenantIds.push(tenantId);
  const created = await app.inject({
    method: "POST",
    url: `/v1/tenants/${tenantId}/bots`,
    headers: { cookie },
    payload: { name: "Pine Café Assistant", pack: "cafe-bakery", hostedPageEnabled: true },
  });
  botId = created.json().bot.id;
  publicKey = created.json().keys[0].publicKey;
});

afterAll(async () => {
  await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("limiters", () => {
  it("shares one policy refresh across a burst and reloads after invalidation", async () => {
    const platform = new PlatformConfig(appDb.db);
    const reads = vi.spyOn(appDb.db, "select");
    try {
      await Promise.all(Array.from({ length: 50 }, () => platform.plan("business")));
      expect(reads).toHaveBeenCalledTimes(2); // plans and settings
      platform.invalidate();
      await platform.policies();
      expect(reads).toHaveBeenCalledTimes(4);
    } finally {
      reads.mockRestore();
    }
  });
  it("memory limiter enforces windows and releases slots", async () => {
    const limiter = new MemoryLimiter();
    expect(await limiter.hit("k", 2, 60)).toBe(true);
    expect(await limiter.hit("k", 2, 60)).toBe(true);
    expect(await limiter.hit("k", 2, 60)).toBe(false);
    const a = await limiter.acquire("s", 1, 60);
    expect(a).not.toBeNull();
    expect(await limiter.acquire("s", 1, 60)).toBeNull();
    await a!();
    await a!(); // releasing twice is harmless
    expect(await limiter.acquire("s", 1, 60)).not.toBeNull();
  });

  it("redis limiter shares counters between servers", async (ctx) => {
    const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
    });
    try {
      await redis.connect();
    } catch {
      redis.disconnect();
      ctx.skip();
      return;
    }
    const prefix = `tb:test:${crypto.randomUUID()}:`;
    const serverA = new RedisLimiter(redis, prefix);
    const serverB = new RedisLimiter(redis, prefix);
    expect(await serverA.hit("rate", 2, 60)).toBe(true);
    expect(await serverB.hit("rate", 2, 60)).toBe(true);
    expect(await serverA.hit("rate", 2, 60)).toBe(false);
    const slot = await serverA.acquire("slots", 1, 60);
    expect(await serverB.acquire("slots", 1, 60)).toBeNull();
    await slot!();
    expect(await serverB.acquire("slots", 1, 60)).not.toBeNull();
    redis.disconnect();
  });
});

describe("monthly question limit", () => {
  it("answers up to the limit, then politely refuses and reports it", async () => {
    expect((await setLimits({ monthlyQuestionLimit: 2 })).statusCode).toBe(200);
    expect((await ask(app, "Do you have croissants?")).res.statusCode).toBe(200);
    expect((await ask(app, "Do you have muffins?")).res.statusCode).toBe(200);
    const refused = await ask(app, "Do you have bagels?");
    expect(refused.res.statusCode).toBe(429);
    expect(refused.res.json().error).toBe("quota");

    const report = await usage();
    expect(report.month).toMatchObject({ questions: 2, remaining: 0, blockedQuota: 1, period: periodKey() });
    expect(report.limits.effectiveMonthlyLimit).toBe(2);
  });

  it("can't be set above the plan's allowance", async () => {
    const res = await setLimits({ monthlyQuestionLimit: 101 }); // trial plan: 100
    expect(res.statusCode).toBe(400);
    expect((await setLimits({ monthlyQuestionLimit: null })).json().limits.monthlyQuestionLimit).toBeNull();
    expect((await usage()).limits.effectiveMonthlyLimit).toBe(100);
  });
});

describe("abuse protection", () => {
  it("limits questions per visitor per day without affecting other visitors", async () => {
    await setLimits({ visitorDailyLimit: 3 });
    // visitor-aaaa already asked 2 questions above.
    expect((await ask(app, "Opening hours?")).res.statusCode).toBe(200);
    const refused = await ask(app, "Opening hours again?");
    expect(refused.res.json().error).toBe("visitor");
    expect((await ask(app, "Hello", { visitorId: "visitor-bbbb" })).res.statusCode).toBe(200);
    expect((await usage()).month.blockedVisitor).toBe(1);
    await setLimits({ visitorDailyLimit: null });
  });

  it("asks the visitor to start a new conversation after too many questions", async () => {
    const first = await ask(app, "Q1", { visitorId: "visitor-cccc" });
    const conversationId = first.conversationId!;
    await ask(app, "Q2", { visitorId: "visitor-cccc", conversationId });
    await ask(app, "Q3", { visitorId: "visitor-cccc", conversationId });
    const fourth = await ask(app, "Q4", { visitorId: "visitor-cccc", conversationId });
    expect(fourth.res.json().error).toBe("conversation");
    expect((await ask(app, "Q4 in a new chat", { visitorId: "visitor-cccc" })).res.statusCode).toBe(200);
  });
});

describe("noisy neighbours", () => {
  it("returns the slot when the question cannot be counted", async () => {
    const release = vi.fn(async () => {});
    const limiter: Limiter = {
      hit: async () => true,
      acquire: async () => {
        vi.spyOn(appDb.db, "transaction").mockRejectedValueOnce(new Error("quota store unavailable"));
        return release;
      },
    };
    const failing = await makeApp({ limiter });
    try {
      expect((await ask(failing, "Hours?", { visitorId: "visitor-transient" })).res.statusCode).toBe(500);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      await failing.close();
    }
  });
  it("tells visitors to try again when the business is at capacity", async () => {
    const full: Limiter = { hit: async () => true, acquire: async () => null };
    const busyApp = await makeApp({ limiter: full });
    const res = await ask(busyApp, "Anyone there?");
    expect(res.res.statusCode).toBe(429);
    expect(res.res.json().error).toBe("busy");
    expect(res.res.headers["retry-after"]).toBe("30");
    expect((await usage()).month.blockedBusy).toBe(1);
    await busyApp.close();
  });

  it("shows a busy message when every AI provider is rate-limited", async () => {
    const overloaded: LLMProvider = {
      id: "overloaded",
      supportsImages: () => false,
      // biome-ignore lint/correctness/useYield: always fails before producing text
      async *stream() {
        throw Object.assign(new Error("rate limited"), { status: 429 });
      },
    };
    const gateway = new LLMGateway({
      providers: [overloaded],
      routes: {
        chat: [{ provider: "overloaded", model: "x" }],
        aux: [{ provider: "overloaded", model: "x" }],
      },
    });
    const busyApp = await makeApp({ gateway });
    const { events } = await ask(busyApp, "Hi there", { visitorId: "visitor-dddd" });
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join("");
    expect(text).toContain("Lots of people are asking questions right now");
    expect(events.at(-1)).toMatchObject({ type: "done", flags: { busy: true } });
    await busyApp.close();
  });
});

describe("usage report", () => {
  it("shows daily questions, assistants, channels and cost", async () => {
    const report = await usage();
    expect(report.daily).toHaveLength(30);
    expect(report.daily.at(-1).questions).toBeGreaterThan(0);
    expect(report.byAssistant).toEqual([expect.objectContaining({ botId, name: "Pine Café Assistant" })]);
    expect(report.byChannel[0]).toMatchObject({ channel: "hosted" });
    expect(report.month.costMicros).toBe(0); // offline provider has no cost
    expect(report.plan).toMatchObject({ id: "trial", monthlyQuestions: 100 });
  });

  it("is private to the business", async () => {
    const email = `nosy-${crypto.randomUUID().slice(0, 8)}@test.local`;
    emails.push(email);
    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email, password: "correct-horse-battery", name: "Nosy" },
    });
    const other = `tb_session=${signup.cookies.find((c) => c.name === "tb_session")!.value}`;
    expect(
      (await app.inject({ method: "GET", url: `/v1/tenants/${tenantId}/usage`, headers: { cookie: other } }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/tenants/${tenantId}/limits`,
          headers: { cookie: other },
          payload: { monthlyQuestionLimit: 1 },
        })
      ).statusCode,
    ).toBe(404);
    const [row] = await ownerDb.db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(row!.monthlyQuestionLimit).toBeNull();
  });
});

it("gives a configured campus address its own bounded allowance while enforcing tenant admission", async () => {
  const campusIp = "203.0.113.10";
  const ordinaryIp = "198.51.100.8";
  const campusApp = await makeApp({
    config: loadConfig({
      NODE_ENV: "test",
      PUBLIC_URL: PUBLIC,
      TRUST_PROXY: "false",
      CHAT_RATE_LIMIT_PER_MIN: "1",
      CHAT_SHARED_IPV4_LIMITS: JSON.stringify({ [campusIp]: 3 }),
    }),
  });
  const send = (remoteAddress: string) =>
    campusApp.inject({
      method: "POST",
      url: "/v1/public/chat",
      remoteAddress,
      headers: { origin: PUBLIC, "x-forwarded-for": campusIp },
      payload: { publicKey, visitorId: crypto.randomUUID(), message: "Opening hours?", channel: "hosted" },
    });
  try {
    expect((await send(ordinaryIp)).statusCode).toBe(200);
    expect((await send(ordinaryIp)).statusCode).toBe(429);
    expect((await send(campusIp)).statusCode).toBe(200);
    expect((await send(campusIp)).statusCode).toBe(200);
    await setLimits({ monthlyQuestionLimit: 1 });
    expect((await send(campusIp)).json().error).toBe("quota");
    await setLimits({ monthlyQuestionLimit: null });
    expect((await send(campusIp)).statusCode).toBe(429);
  } finally {
    await setLimits({ monthlyQuestionLimit: null });
    await campusApp.close();
  }
});
