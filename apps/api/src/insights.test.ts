import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  conversationInsights,
  conversations,
  createDb,
  type DbHandle,
  leads,
  messages,
  pageStats,
  runMigrations,
  tenants,
  users,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { REPORTING_TIME_ZONE } from "@traiblazer/shared";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PlatformConfig } from "./lib/platform.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
const tenantIds: string[] = [];
const emails: string[] = [];

/** A signed-up owner with one business (on the default plan) and one assistant. */
async function business(name: string) {
  const email = `owner-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const signup = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name: "Owner" },
  });
  const cookie = `tb_session=${signup.cookies.find((c) => c.name === "tb_session")!.value}`;
  const tenantId = (
    await app.inject({ method: "POST", url: "/v1/tenants", headers: { cookie }, payload: { name } })
  ).json().tenant.id as string;
  tenantIds.push(tenantId);
  const created = await app.inject({
    method: "POST",
    url: `/v1/tenants/${tenantId}/bots`,
    headers: { cookie },
    payload: { name: `${name} assistant`, pack: "auto-repair" },
  });
  const botId = created.json().bot.id as string;
  return { cookie, tenantId, botId, base: `/v1/tenants/${tenantId}/bots/${botId}` };
}

let owner: Awaited<ReturnType<typeof business>>;
const get = (url: string, cookie = owner.cookie) => app.inject({ method: "GET", url, headers: { cookie } });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIME_ZONE }).format(new Date());

/** A conversation from today with `questions` visitor messages. */
async function conversation(
  channel: "hosted" | "sms" | "widget" | "playground",
  questions: number,
  requested = false,
) {
  const { tenantId, botId } = owner;
  const [row] = await ownerDb.db
    .insert(conversations)
    .values({
      tenantId,
      botId,
      channel,
      visitorId: crypto.randomUUID(),
      language: "en",
      messageCount: questions * 2,
    })
    .returning({ id: conversations.id });
  await ownerDb.db.insert(messages).values(
    Array.from({ length: questions }, () => ({
      tenantId,
      conversationId: row!.id,
      role: "user" as const,
      content: "How much?",
    })),
  );
  if (requested) {
    await ownerDb.db.insert(leads).values({
      tenantId,
      botId,
      conversationId: row!.id,
      channel,
      kind: "quote",
      name: "Sam",
      message: "Quote",
      language: "en",
    });
  }
}

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const dist = await mkdtemp(path.join(tmpdir(), "tb-insights-"));
  await mkdir(path.join(dist, "assets"));
  await writeFile(path.join(dist, "index.html"), "<!doctype html><title>Chat</title>");
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    CHAT_RATE_LIMIT_PER_MIN: "1000",
    PUBLIC_URL: "http://chat.test.local",
    ADMIN_ORIGIN: "http://admin.test.local",
  } as NodeJS.ProcessEnv);
  app = await buildApp({
    db: appDb.db,
    config,
    gateway: createGatewayFromEnv({}).gateway,
    chatDistDir: dist,
    platform: new PlatformConfig(appDb.db, 0),
  });
  owner = await business("Lakehead Heating");
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("insights", () => {
  it("is locked on a plan without Insights, and the session says so", async () => {
    const res = await get(`${owner.base}/insights`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("plan_required");
    const me = (await get("/v1/auth/me")).json();
    expect(me.tenants.find((t: { id: string }) => t.id === owner.tenantId).features).toEqual({
      insights: false,
    });
    // The public plan list says which plans include it.
    const plans = (await get("/v1/catalog/plans")).json().plans as { id: string; insights: boolean }[];
    expect(plans.filter((p) => p.insights).map((p) => p.id)).toEqual(["professional", "business"]);
  });

  it("shows the funnel, conversion and tags once the plan includes it", async () => {
    await ownerDb.db.update(tenants).set({ plan: "professional" }).where(eq(tenants.id, owner.tenantId));
    const me = (await get("/v1/auth/me")).json();
    expect(me.tenants.find((t: { id: string }) => t.id === owner.tenantId).features).toEqual({
      insights: true,
    });

    const { tenantId, botId } = owner;
    const day = today();
    await ownerDb.db.insert(pageStats).values({ tenantId, botId, day, views: 40, call: 3, book: 1 });
    await conversation("hosted", 2, true);
    await conversation("hosted", 1);
    await conversation("hosted", 3);
    await conversation("sms", 1, true);
    await conversation("playground", 5, true); // the owner's own test: never counted
    await ownerDb.db.insert(conversationInsights).values([
      { tenantId, botId, day, channel: "hosted", dimension: "outcome", value: "request", count: 1 },
      { tenantId, botId, day, channel: "hosted", dimension: "outcome", value: "answered", count: 2 },
      { tenantId, botId, day, channel: "hosted", dimension: "intent", value: "price", count: 2 },
      { tenantId, botId, day, channel: "hosted", dimension: "intent", value: "booking", count: 1 },
      { tenantId, botId, day, channel: "hosted", dimension: "intent_request", value: "booking", count: 1 },
      { tenantId, botId, day, channel: "hosted", dimension: "blocker", value: "price", count: 2 },
      { tenantId, botId, day, channel: "hosted", dimension: "sentiment", value: "negative", count: 1 },
      { tenantId, botId, day, channel: "hosted", dimension: "sentiment", value: "positive", count: 2 },
    ]);

    const res = await get(`${owner.base}/insights?days=7`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toBe(7);
    expect(body.funnel.current).toEqual({ views: 40, conversations: 4, offered: 0, taps: 4, requests: 2 });
    expect(body.funnel.previous).toEqual({ views: 0, conversations: 0, offered: 0, taps: 0, requests: 0 });
    expect(body.channels).toEqual([
      { channel: "page", conversations: 3, requests: 1 },
      { channel: "sms", conversations: 1, requests: 1 },
    ]);
    expect(body.languages).toEqual([{ language: "en", conversations: 4, requests: 2 }]);
    expect(body.analyzed).toBe(3);
    expect(body.intents).toEqual([
      { intent: "price", conversations: 2, requests: 0 },
      { intent: "booking", conversations: 1, requests: 1 },
    ]);
    expect(body.blockers).toEqual({ price: 2 });
    expect(body.sentiment).toHaveLength(7);
    expect(body.sentiment.at(-1)).toEqual({ date: day, positive: 2, neutral: 0, negative: 1 });
    expect(body.busyTimes.reduce((n: number, b: { n: number }) => n + b.n, 0)).toBe(7);
  });

  it("is not visible to other businesses", async () => {
    const other = await business("Other Heating");
    const res = await get(`${owner.base}/insights`, other.cookie);
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
  });
});
