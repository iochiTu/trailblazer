import { randomBytes } from "node:crypto";
import { runAddonEffect } from "@traiblazer/core";
import {
  auditLogs,
  createDb,
  type DbHandle,
  integrationConnections,
  jobs,
  leadSyncs,
  leads,
  runMigrations,
  tenants,
  users,
} from "@traiblazer/db";
import { type IntegrationsConfig, loadIntegrationsConfig } from "@traiblazer/integrations";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const ADMIN = "http://admin.test.local";
const HOOK = "https://hooks.test.example/catch/abc123";

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let cookie: string;
let tenantId: string;
let botId: string;
let integrations: IntegrationsConfig;
const emails: string[] = [];
const tenantIds: string[] = [];

/** What the "CRM" answers next, and what it was sent. */
let hookStatus = 200;
const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
const crm = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  sent.push({
    url,
    body: String(init?.body ?? ""),
    headers: (init?.headers ?? {}) as Record<string, string>,
  });
  if (url.includes("/oauth/token")) {
    return Response.json({
      access_token: "jobber-access",
      refresh_token: "jobber-refresh",
      expires_in: 3600,
    });
  }
  if (url.includes("/api/graphql"))
    return Response.json({ data: { account: { id: "a1", name: "Maple Plumbing Ltd" } } });
  return new Response("", { status: hookStatus });
}) as typeof fetch;

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

const botUrl = (path: string) => `/v1/tenants/${tenantId}/bots/${botId}${path}`;
const call = (
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  payload?: unknown,
  headers = { cookie },
) =>
  app.inject({
    method,
    url: botUrl(path),
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const connection = async (provider: string) =>
  (
    await ownerDb.db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.botId, botId), eq(integrationConnections.provider, provider)))
  )[0];

async function addLead(channel: "web" | "playground" = "web") {
  const [lead] = await ownerDb.db
    .insert(leads)
    .values({
      tenantId,
      botId,
      channel,
      kind: "quote",
      name: "Jean Tremblay",
      email: "jean@example.com",
      phone: "807-555-0142",
      message: "Leaking water heater, wants a quote.",
      urgent: false,
    })
    .returning();
  return lead!.id;
}

const push = (provider: string, leadId: string) =>
  runAddonEffect(
    { db: appDb.db, mailer: { send: async () => {} }, integrations, fetch: crm, adminUrl: ADMIN },
    tenantId,
    { botId, addonId: provider, effect: { kind: "crm.lead", provider, leadId } },
  );

const syncOf = async (leadId: string) =>
  (await ownerDb.db.select().from(leadSyncs).where(eq(leadSyncs.leadId, leadId)))[0];

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    ADMIN_ORIGIN: ADMIN,
  } as NodeJS.ProcessEnv);
  integrations = loadIntegrationsConfig({
    INTEGRATIONS_SECRET_KEY: randomBytes(32).toString("hex"),
    JOBBER_CLIENT_ID: "jobber-client",
    JOBBER_CLIENT_SECRET: "jobber-secret",
  });
  app = await buildApp({
    db: appDb.db,
    config,
    gateway: createGatewayFromEnv({}).gateway,
    integrations,
    integrationsFetch: crm,
  });

  cookie = await signup("crm-owner");
  tenantId = await createTenant(cookie, "Maple Plumbing");
  const created = await app.inject({
    method: "POST",
    url: `/v1/tenants/${tenantId}/bots`,
    headers: { cookie },
    payload: { name: "Maple Plumbing Assistant", pack: "trades" },
  });
  expect(created.statusCode).toBeLessThan(300);
  botId = created.json().bot.id;
});

beforeEach(() => {
  hookStatus = 200;
  sent.length = 0;
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("CRM integrations", () => {
  it("lists connectors, and which this server can connect", async () => {
    const res = await call("GET", "/integrations");
    expect(res.statusCode).toBe(200);
    const list = res.json().integrations as { id: string; available: boolean; connection: unknown }[];
    expect(list.map((i) => i.id)).toEqual(
      expect.arrayContaining(["jobber", "housecall-pro", "servicetitan", "webhook"]),
    );
    expect(list.find((i) => i.id === "webhook")).toMatchObject({ available: true, connection: null });
    // No ServiceTitan app key on this server.
    expect(list.find((i) => i.id === "servicetitan")!.available).toBe(false);
    expect(
      (await call("PUT", "/integrations/servicetitan", { credentials: { tenantId: "1" } })).statusCode,
    ).toBe(409);
    expect((await call("PUT", "/integrations/nope", { credentials: {} })).statusCode).toBe(404);

    const catalog = (await call("GET", "/addons")).json().catalog as {
      id: string;
      integration: string | null;
    }[];
    expect(catalog.find((a) => a.id === "jobber")!.integration).toBe("jobber");
    expect(catalog.find((a) => a.id === "online-shop")!.integration).toBeNull();
  });

  it("checks keys with the CRM before saving them, sealed", async () => {
    const missing = await call("PUT", "/integrations/webhook", { credentials: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().issues[0].path).toBe("url");

    hookStatus = 404;
    const refused = await call("PUT", "/integrations/webhook", { credentials: { url: HOOK } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe("connection_failed");
    expect(await connection("webhook")).toBeUndefined();

    hookStatus = 200;
    const ok = await call("PUT", "/integrations/webhook", {
      credentials: { url: HOOK, secret: "shh", extra: "x" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().connection).toEqual({ status: "connected", accountName: "hooks.test.example" });
    expect(JSON.parse(sent.at(-1)!.body).event).toBe("ping");

    // Nothing readable in the database, and nothing at all in the API's answers.
    const row = await connection("webhook");
    expect(row!.credentials).toMatch(/^v1\./);
    expect(row!.credentials).not.toContain("abc123");
    const listed = (await call("GET", "/integrations")).body;
    expect(listed).not.toContain("abc123");
    expect(listed).not.toContain("shh");
    expect(listed).not.toContain(row!.credentials);

    const audited = await ownerDb.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "integration.connected")));
    expect(audited).toHaveLength(1);
    expect(JSON.stringify(audited[0]!.metadata)).not.toContain("abc123");
  });

  it("sends a request to the CRM once, and shows it on the request", async () => {
    expect((await call("PUT", "/addons/webhook", { config: {} })).statusCode).toBe(200);
    const leadId = await addLead();
    expect(await push("webhook", leadId)).toBe("done");

    const delivered = sent.at(-1)!;
    expect(delivered.url).toBe(HOOK);
    expect(delivered.headers["x-traiblazer-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(delivered.body).request).toMatchObject({
      id: leadId,
      name: "Jean Tremblay",
      phone: "807-555-0142",
      business: "Maple Plumbing",
      url: `${ADMIN}/t/${tenantId}/bots/${botId}?tab=requests`,
    });
    expect(await syncOf(leadId)).toMatchObject({ provider: "webhook", status: "sent", error: null });

    // A repeated job (retry after a crash) doesn't create it twice.
    sent.length = 0;
    expect(await push("webhook", leadId)).toBe("skipped");
    expect(sent).toHaveLength(0);

    const listed = (await call("GET", "/leads")).json().leads as { id: string; syncs: unknown[] }[];
    expect(listed.find((l) => l.id === leadId)!.syncs).toEqual([
      expect.objectContaining({ provider: "webhook", providerName: "Webhook", status: "sent" }),
    ]);
  });

  it("never sends the owner's own test requests", async () => {
    const leadId = await addLead("playground");
    expect(await push("webhook", leadId)).toBe("skipped");
    expect(sent).toHaveLength(0);
    expect((await call("POST", `/leads/${leadId}/sync/webhook`)).statusCode).toBe(400);
  });

  it("retries an outage, flags a dead connection, and lets staff send again", async () => {
    const leadId = await addLead();
    hookStatus = 503;
    await expect(push("webhook", leadId)).rejects.toMatchObject({ failure: "temporary" });
    expect(await syncOf(leadId)).toMatchObject({ status: "failed" });
    expect((await connection("webhook"))!.status).toBe("connected");

    hookStatus = 410;
    expect(await push("webhook", leadId)).toBe("failed");
    expect((await connection("webhook"))!).toMatchObject({ status: "error" });
    expect((await syncOf(leadId))!.error).toContain("410");

    // The owner fixes the hook and connects again; staff press "Send again".
    hookStatus = 200;
    expect((await call("PUT", "/integrations/webhook", { credentials: { url: HOOK } })).statusCode).toBe(200);
    expect((await connection("webhook"))!).toMatchObject({ status: "connected", lastError: null });
    const again = await call("POST", `/leads/${leadId}/sync/webhook`);
    expect(again.statusCode).toBe(202);
    const [job] = await ownerDb.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, "addon.effect")));
    expect(job!.payload).toEqual({
      botId,
      addonId: "webhook",
      effect: { kind: "crm.lead", provider: "webhook", leadId },
    });
    expect(
      await runAddonEffect(
        { db: appDb.db, mailer: { send: async () => {} }, integrations, fetch: crm },
        tenantId,
        job!.payload as never,
      ),
    ).toBe("done");
    expect(await syncOf(leadId)).toMatchObject({ status: "sent", error: null });
    expect((await call("POST", `/leads/${leadId}/sync/webhook`)).statusCode).toBe(409);
  });

  it("connects Jobber by signing in", async () => {
    const start = await call("POST", "/integrations/jobber/oauth");
    expect(start.statusCode).toBe(200);
    const url = new URL(start.json().url);
    expect(url.host).toBe("api.getjobber.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ADMIN}/api/v1/integrations/oauth/callback`);
    const state = url.searchParams.get("state")!;
    const callback = (query: Record<string, string>, headers: Record<string, string> = { cookie }) =>
      app.inject({
        method: "GET",
        url: `/v1/integrations/oauth/callback?${new URLSearchParams(query)}`,
        headers,
      });

    // A forged state goes nowhere; someone else's browser can't finish the owner's sign-in.
    expect((await callback({ code: "c", state: `${state}x` })).headers.location).toBe(ADMIN);
    const stranger = await signup("crm-stranger");
    const hijack = await callback({ code: "c", state }, { cookie: stranger });
    expect(hijack.headers.location).toContain("result=error");
    expect(await connection("jobber")).toBeUndefined();

    const done = await callback({ code: "the-code", state });
    expect(done.statusCode).toBe(302);
    expect(done.headers.location).toBe(
      `${ADMIN}/t/${tenantId}/bots/${botId}?tab=addons&integration=jobber&result=connected`,
    );
    expect(new URLSearchParams(sent.find((s) => s.url.includes("/oauth/token"))!.body).get("code")).toBe(
      "the-code",
    );
    const row = await connection("jobber");
    expect(row).toMatchObject({ status: "connected", accountName: "Maple Plumbing Ltd" });
    expect(row!.credentials).not.toContain("jobber-refresh");
    // Pasting keys isn't how Jobber connects.
    expect((await call("PUT", "/integrations/jobber", { credentials: { x: "y" } })).statusCode).toBe(400);
  });

  it("keeps other businesses and non-admins out", async () => {
    const other = await signup("crm-other");
    await createTenant(other, "Other Co");
    for (const res of [
      await call("GET", "/integrations", undefined, { cookie: other }),
      await call("PUT", "/integrations/webhook", { credentials: { url: HOOK } }, { cookie: other }),
      await call("DELETE", "/integrations/webhook", undefined, { cookie: other }),
    ]) {
      expect([403, 404]).toContain(res.statusCode);
    }
    expect((await call("GET", "/integrations", undefined, { cookie: "" })).statusCode).toBe(401);
    expect(await connection("webhook")).toBeDefined();
  });

  it("erases credentials on disconnect and when the add-on is removed", async () => {
    expect((await call("DELETE", "/integrations/jobber")).statusCode).toBe(204);
    expect(await connection("jobber")).toBeUndefined();
    expect((await call("DELETE", "/integrations/jobber")).statusCode).toBe(404);

    expect((await call("DELETE", "/addons/webhook")).statusCode).toBe(204);
    expect(await connection("webhook")).toBeUndefined();
    // With the add-on gone, a job still in the queue does nothing.
    expect(await push("webhook", await addLead())).toBe("skipped");
  });
});
