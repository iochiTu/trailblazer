import { runAddonEffect } from "@traiblazer/core";
import { auditLogs, createDb, type DbHandle, jobs, runMigrations, tenants, users } from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const PUBLIC = "http://chat.test.local";
const ADMIN = "http://admin.test.local";

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let cookie: string;
let tenantId: string;
let botId: string;
let publicKey: string;
const emails: string[] = [];
const tenantIds: string[] = [];

async function signup(name: string) {
  const email = `${name}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name },
  });
  return `tb_session=${res.cookies.find((c) => c.name === "tb_session")!.value}`;
}

async function createTenant(sessionCookie: string, name: string) {
  const id = (
    await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: { cookie: sessionCookie },
      payload: { name },
    })
  ).json().tenant.id as string;
  tenantIds.push(id);
  return id;
}

const addonsUrl = (addonId = "") =>
  `/v1/tenants/${tenantId}/bots/${botId}/addons${addonId ? `/${addonId}` : ""}`;

const put = (addonId: string, payload: unknown, headers = { cookie }) =>
  app.inject({ method: "PUT", url: addonsUrl(addonId), headers, payload: payload as object });

const chat = (message: string, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/public/chat",
    headers: { origin: PUBLIC },
    payload: { publicKey, visitorId: `visitor-${crypto.randomUUID().slice(0, 8)}`, message, ...extra },
  });

const effectJobs = () =>
  ownerDb.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, "addon.effect")));

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    CHAT_RATE_LIMIT_PER_MIN: "1000",
    PUBLIC_URL: PUBLIC,
    ADMIN_ORIGIN: ADMIN,
  } as NodeJS.ProcessEnv);
  app = await buildApp({ db: appDb.db, config, gateway: createGatewayFromEnv({}).gateway });

  cookie = await signup("addons-owner");
  tenantId = await createTenant(cookie, "Maple Bakery");
  const created = await app.inject({
    method: "POST",
    url: `/v1/tenants/${tenantId}/bots`,
    headers: { cookie },
    payload: { name: "Maple Bakery Assistant", pack: "cafe-bakery" },
  });
  botId = created.json().bot.id;
  publicKey = created.json().keys[0].publicKey;
  await app.inject({
    method: "PATCH",
    url: `/v1/tenants/${tenantId}/bots/${botId}`,
    headers: { cookie },
    payload: { status: "active" },
  });
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("add-on market", () => {
  it("lists the market and starts with nothing installed", async () => {
    const catalog = await app.inject({ method: "GET", url: "/v1/catalog/addons" });
    const ids = catalog.json().addons.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["email-notifications", "online-shop", "catalog-sync"]));

    const res = await app.inject({ method: "GET", url: addonsUrl(), headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().installed).toEqual([]);
    expect(res.json().catalog.length).toBe(ids.length);
  });

  it("validates settings with the add-on's own rules", async () => {
    const bad = await put("online-shop", { config: { url: "not a url" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("invalid_addon_config");
    expect(bad.json().issues[0].path).toBe("url");

    expect((await put("catalog-sync", {})).statusCode).toBe(400);
    expect((await put("no-such-addon", {})).statusCode).toBe(404);
  });

  it("keeps other businesses out", async () => {
    const otherCookie = await signup("addons-stranger");
    await createTenant(otherCookie, "Stranger Co");
    const res = await app.inject({ method: "GET", url: addonsUrl(), headers: { cookie: otherCookie } });
    expect([403, 404]).toContain(res.statusCode);
    expect(
      (await put("online-shop", { config: { url: "https://evil.example" } }, { cookie: otherCookie }))
        .statusCode,
    ).not.toBe(200);
  });
});

describe("online shop add-on", () => {
  it("adds a Shop button to the chat page config, and removes it again", async () => {
    const res = await put("online-shop", {
      config: { url: "https://shop.maple.example", platform: "shopify", buttonLabel: "Order cakes" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().addon).toMatchObject({ addonId: "online-shop", enabled: true, status: "ok" });

    const config = await app.inject({ method: "GET", url: `/v1/public/bots/${publicKey}` });
    expect(config.json().bot.links).toEqual([
      { id: "online-shop", url: "https://shop.maple.example", label: "Order cakes", icon: "shop" },
    ]);

    // Turning it off keeps the settings but hides the button.
    expect((await put("online-shop", { enabled: false })).json().addon.config.url).toBe(
      "https://shop.maple.example",
    );
    const off = await app.inject({ method: "GET", url: `/v1/public/bots/${publicKey}` });
    expect(off.json().bot.links).toEqual([]);

    expect(
      (await app.inject({ method: "DELETE", url: addonsUrl("online-shop"), headers: { cookie } })).statusCode,
    ).toBe(204);
    const log = await ownerDb.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantId));
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining(["addon.installed", "addon.updated", "addon.removed"]),
    );
  });
});

describe("email notifications add-on", () => {
  it("queues an email for new conversations, but not for the owner's test chat", async () => {
    expect((await put("email-notifications", { config: { email: "Owner@Maple.example" } })).statusCode).toBe(
      200,
    );

    expect((await chat("Do you sell sourdough?", { channel: "playground" })).statusCode).toBe(200);
    expect(await effectJobs()).toEqual([]);

    expect((await chat("Do you sell sourdough?", { channel: "widget" })).statusCode).toBe(200);
    const queued = await effectJobs();
    const started = queued.find((j) =>
      (j.payload as { effect: { subject: string } }).effect.subject.startsWith("New chat"),
    );
    expect(started?.payload).toMatchObject({
      botId,
      addonId: "email-notifications",
      effect: { kind: "email", to: ["owner@maple.example"] },
    });
    expect((started!.payload as { effect: { text: string } }).effect.text).toContain(
      `${ADMIN}/t/${tenantId}/bots/${botId}?tab=conversations`,
    );
  });

  it("sends queued email only while the add-on is still on", async () => {
    const [job] = await effectJobs();
    const sent: string[] = [];
    const mailer = { send: async (m: { subject: string }) => void sent.push(m.subject) };
    const payload = job!.payload as Parameters<typeof runAddonEffect>[2];

    expect(await runAddonEffect({ db: appDb.db, mailer }, tenantId, payload)).toBe("done");
    expect(sent.length).toBe(1);

    await put("email-notifications", { enabled: false });
    expect(await runAddonEffect({ db: appDb.db, mailer }, tenantId, payload)).toBe("skipped");
    expect(sent.length).toBe(1);
  });
});
