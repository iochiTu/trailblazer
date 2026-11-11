import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  conversations,
  createDb,
  type DbHandle,
  leads,
  messages,
  runMigrations,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { isPersonVisit } from "./lib/page-stats.js";
import { PlatformConfig } from "./lib/platform.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const PUBLIC = "http://chat.test.local";
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Chat</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
const tenantIds: string[] = [];
const emails: string[] = [];

/** A signed-up owner with one business and one Auto repair assistant. */
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
  const base = `/v1/tenants/${tenantId}/bots/${botId}`;
  return { cookie, tenantId, botId, base, publicKey: created.json().keys[0].publicKey as string };
}

let owner: Awaited<ReturnType<typeof business>>;

const call = (method: "GET" | "PATCH" | "PUT", url: string, payload?: unknown, cookie = owner.cookie) =>
  app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const open = (url: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: "GET",
    url,
    headers: { "sec-fetch-dest": "document", "user-agent": BROWSER, ...headers },
  });

const tap = (action: string, publicKey = owner.publicKey, origin = PUBLIC) =>
  app.inject({
    method: "POST",
    url: "/v1/public/page-events",
    headers: { origin, "content-type": "application/json" },
    payload: { publicKey, action },
  });

const stats = async (days?: number) =>
  (await call("GET", `${owner.base}/page-stats${days ? `?days=${days}` : ""}`)).json();

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const dist = await mkdtemp(path.join(tmpdir(), "tb-stats-"));
  await mkdir(path.join(dist, "assets"));
  await writeFile(path.join(dist, "index.html"), TEMPLATE);
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    CHAT_RATE_LIMIT_PER_MIN: "1000",
    PUBLIC_URL: PUBLIC,
    ADMIN_ORIGIN: "http://admin.test.local",
  } as NodeJS.ProcessEnv);
  app = await buildApp({
    db: appDb.db,
    config,
    gateway: createGatewayFromEnv({}).gateway,
    chatDistDir: dist,
    platform: new PlatformConfig(appDb.db, 30_000),
  });
  owner = await business("Lakehead Auto");
  await call("PUT", `${owner.base}/profile`, {
    businessName: "Lakehead Auto",
    phone: "807-555-0100",
    email: "shop@lakehead.test",
    address: { full: "12 Red River Rd, Thunder Bay" },
    bookingUrl: "https://book.lakehead.test",
  });
  await call("PATCH", owner.base, { hostedPageEnabled: true });
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("who counts as a visitor", () => {
  it("counts a browser opening the page, not robots, prefetches or frames", () => {
    expect(isPersonVisit({ "sec-fetch-dest": "document", "user-agent": BROWSER })).toBe(true);
    expect(isPersonVisit({ "user-agent": BROWSER })).toBe(false);
    expect(isPersonVisit({ "sec-fetch-dest": "iframe", "user-agent": BROWSER })).toBe(false);
    expect(isPersonVisit({ "sec-fetch-dest": "document" })).toBe(false);
    expect(
      isPersonVisit({
        "sec-fetch-dest": "document",
        "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      }),
    ).toBe(false);
    expect(isPersonVisit({ "sec-fetch-dest": "document", "user-agent": "facebookexternalhit/1.1" })).toBe(
      false,
    );
    expect(
      isPersonVisit({ "sec-fetch-dest": "document", "user-agent": BROWSER, "sec-purpose": "prefetch" }),
    ).toBe(false);
  });
});

describe("page statistics", () => {
  it("starts at zero for every day of the period", async () => {
    const report = await stats();
    expect(report.days).toBe(30);
    expect(report.daily).toHaveLength(30);
    expect(report.totals).toEqual({
      views: 0,
      taps: { call: 0, book: 0, email: 0, directions: 0, website: 0, link: 0 },
      questions: 0,
      conversations: 0,
      requests: 0,
      urgentRequests: 0,
    });
    expect((await stats(7)).daily).toHaveLength(7);
    expect((await stats(1000)).daily).toHaveLength(90);
  });

  it("marks the contact buttons so the page can count taps", async () => {
    const html = (await open(`/c/${owner.publicKey}`)).body;
    for (const action of ["call", "book", "email", "directions"]) {
      expect(html).toContain(`data-action="${action}"`);
    }
  });

  it("counts views only once the assistant is live, and never previews, frames or robots", async () => {
    // Draft: the page opens (the earlier test) but isn't counted yet.
    expect((await stats()).totals.views).toBe(0);
    await call("PATCH", owner.base, { status: "active" });
    await open(`/c/${owner.publicKey}`);
    await open(`/c/${owner.publicKey}`);
    await open(`/c/${owner.publicKey}?preview=1`);
    await open(`/c/${owner.publicKey}?embed=inline`, { "sec-fetch-dest": "iframe" });
    await open(`/c/${owner.publicKey}`, { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0)" });
    await open(`/c/${owner.publicKey}`, { "sec-purpose": "prefetch;prerender" });
    const report = await stats();
    expect(report.totals.views).toBe(2);
    expect(report.daily.at(-1)).toMatchObject({ views: 2, taps: 0 });
  });

  it("counts taps on contact buttons sent by the page", async () => {
    expect((await tap("call")).statusCode).toBe(204);
    await tap("call");
    await tap("directions");
    expect((await tap("fax")).statusCode).toBe(400);
    expect((await tap("call", owner.publicKey, "https://elsewhere.test")).statusCode).toBe(403);
    // Unknown keys are accepted silently (nothing to tell a stranger), and not counted anywhere.
    expect((await tap("call", "pk_live_doesnotexist000")).statusCode).toBe(204);
    const report = await stats();
    expect(report.totals.taps).toMatchObject({ call: 2, directions: 1, book: 0 });
    expect(report.daily.at(-1)).toMatchObject({ views: 2, taps: 3 });
  });

  it("stops counting when the web version is switched off", async () => {
    await call("PATCH", owner.base, { hostedPageEnabled: false });
    await tap("call");
    expect((await stats()).totals.taps.call).toBe(2);
    await call("PATCH", owner.base, { hostedPageEnabled: true });
  });

  it("adds visitors' questions and requests, without the owner's tests", async () => {
    await withTenant(appDb.db, owner.tenantId, async (tx) => {
      for (const channel of ["hosted", "widget", "playground"] as const) {
        const [conversation] = await tx
          .insert(conversations)
          .values({ tenantId: owner.tenantId, botId: owner.botId, channel, visitorId: `v-${channel}` })
          .returning();
        await tx.insert(messages).values([
          {
            tenantId: owner.tenantId,
            conversationId: conversation!.id,
            role: "user",
            content: "Open Sunday?",
          },
          { tenantId: owner.tenantId, conversationId: conversation!.id, role: "assistant", content: "No." },
          { tenantId: owner.tenantId, conversationId: conversation!.id, role: "user", content: "Thanks" },
        ]);
      }
      const lead = {
        tenantId: owner.tenantId,
        botId: owner.botId,
        kind: "callback" as const,
        message: "Call me",
      };
      await tx.insert(leads).values([
        { ...lead, channel: "hosted", name: "Ana", urgent: true },
        { ...lead, channel: "widget", name: "Ben" },
        { ...lead, channel: "playground", name: "Owner test" },
      ]);
    });
    const report = await stats();
    expect(report.totals).toMatchObject({ questions: 4, conversations: 2, requests: 2, urgentRequests: 1 });
    expect(report.daily.at(-1)).toMatchObject({ questions: 4, requests: 2 });
  });

  it("is not visible to other businesses", async () => {
    const other = await business("Other Garage");
    const res = await call("GET", `${owner.base}/page-stats`, undefined, other.cookie);
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
    const own = await call("GET", `${other.base}/page-stats`, undefined, other.cookie);
    expect(own.json().totals.views).toBe(0);
  });
});
