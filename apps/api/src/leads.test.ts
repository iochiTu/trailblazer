import {
  auditLogs,
  createDb,
  type DbHandle,
  leads,
  runMigrations,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let cookie: string;
let tenantId: string;
let botId: string;
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

async function createBot(sessionCookie: string, tenant: string, name: string) {
  const res = await app.inject({
    method: "POST",
    url: `/v1/tenants/${tenant}/bots`,
    headers: { cookie: sessionCookie },
    payload: { name, pack: "cafe-bakery" },
  });
  return res.json().bot.id as string;
}

const leadsUrl = (suffix = "", bot = botId) => `/v1/tenants/${tenantId}/bots/${bot}/leads${suffix}`;
const call = (method: "GET" | "PATCH" | "DELETE", url: string, payload?: unknown, headers = { cookie }) =>
  app.inject({ method, url, headers, payload: payload as object | undefined });

/** What the assistant's tool saves; the API only reads and updates these. */
const addLead = async (name: string, extra: Partial<typeof leads.$inferInsert> = {}) =>
  (
    await withTenant(appDb.db, tenantId, (tx) =>
      tx
        .insert(leads)
        .values({
          tenantId,
          botId,
          channel: "widget",
          kind: "callback",
          name,
          phone: "807-555-0100",
          message: "Call me about a cake.",
          ...extra,
        })
        .returning(),
    )
  )[0]!;

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    CHAT_RATE_LIMIT_PER_MIN: "1000",
    PUBLIC_URL: "http://chat.test.local",
    ADMIN_ORIGIN: "http://admin.test.local",
  } as NodeJS.ProcessEnv);
  app = await buildApp({ db: appDb.db, config, gateway: createGatewayFromEnv({}).gateway });

  cookie = await signup("leads-owner");
  tenantId = await createTenant(cookie, "Maple Bakery");
  botId = await createBot(cookie, tenantId, "Maple Bakery Assistant");
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("visitor requests", () => {
  it("lists requests newest first, with how many are new", async () => {
    expect((await call("GET", leadsUrl())).json()).toEqual({ leads: [], newCount: 0 });

    await addLead("First", { createdAt: new Date(Date.now() - 60_000) });
    await addLead("Second", { email: "second@example.com", kind: "quote" });
    await addLead("Handled", { status: "done", createdAt: new Date(Date.now() - 120_000) });

    const all = (await call("GET", leadsUrl())).json();
    expect(all.leads.map((l: { name: string }) => l.name)).toEqual(["Second", "First", "Handled"]);
    expect(all.newCount).toBe(2);
    expect(all.leads[0]).toMatchObject({ kind: "quote", status: "new", email: "second@example.com" });

    const done = (await call("GET", leadsUrl("?status=done"))).json();
    expect(done.leads.map((l: { name: string }) => l.name)).toEqual(["Handled"]);
    // The count is always of new requests, whatever the filter (it feeds the tab's badge).
    expect(done.newCount).toBe(2);
    expect((await call("GET", leadsUrl("?status=archived"))).statusCode).toBe(400);
  });

  it("moves a request through its statuses and records who did it", async () => {
    const lead = await addLead("Status");
    const res = await call("PATCH", leadsUrl(`/${lead.id}`), { status: "in_progress" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lead).toMatchObject({ id: lead.id, status: "in_progress" });
    expect((await call("PATCH", leadsUrl(`/${lead.id}`), { status: "lost" })).statusCode).toBe(400);
    expect((await call("PATCH", leadsUrl(`/${crypto.randomUUID()}`), { status: "done" })).statusCode).toBe(
      404,
    );

    const [entry] = await ownerDb.db.select().from(auditLogs).where(eq(auditLogs.targetId, lead.id));
    expect(entry).toMatchObject({ action: "lead.update", metadata: { status: "in_progress" } });
    // The audit log never copies the visitor's details.
    expect(JSON.stringify(entry)).not.toContain("807-555-0100");
  });

  it("deletes a request", async () => {
    const lead = await addLead("Forget me");
    expect((await call("DELETE", leadsUrl(`/${lead.id}`))).statusCode).toBe(204);
    expect((await call("DELETE", leadsUrl(`/${lead.id}`))).statusCode).toBe(404);
    const names = (await call("GET", leadsUrl())).json().leads.map((l: { name: string }) => l.name);
    expect(names).not.toContain("Forget me");
  });

  it("keeps requests within their assistant and their business", async () => {
    const lead = await addLead("Private");
    // Another assistant of the same business doesn't show or change it.
    const otherBot = await createBot(cookie, tenantId, "Second assistant");
    expect((await call("GET", leadsUrl("", otherBot))).json().leads).toEqual([]);
    expect((await call("PATCH", leadsUrl(`/${lead.id}`, otherBot), { status: "done" })).statusCode).toBe(404);

    // Another business gets nothing at all.
    const stranger = { cookie: await signup("leads-stranger") };
    await createTenant(stranger.cookie, "Stranger Co");
    expect([403, 404]).toContain((await call("GET", leadsUrl(), undefined, stranger)).statusCode);
    expect([403, 404]).toContain(
      (await call("PATCH", leadsUrl(`/${lead.id}`), { status: "done" }, stranger)).statusCode,
    );
    expect([403, 404]).toContain(
      (await call("DELETE", leadsUrl(`/${lead.id}`), undefined, stranger)).statusCode,
    );
    expect((await call("GET", leadsUrl())).json().leads.map((l: { name: string }) => l.name)).toContain(
      "Private",
    );

    expect((await call("GET", "/v1/tenants/x/bots/y/leads")).statusCode).not.toBe(200);
  });

  it("lets the business turn requests off for an assistant", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/tenants/${tenantId}/bots/${botId}`,
      headers: { cookie },
      payload: { settings: { followUps: false } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bot.settings.followUps).toBe(false);
  });

  it("returns the service a request is about", async () => {
    await addLead("Dana Quote", { kind: "quote", itemName: "Wedding cake" });
    const res = await call("GET", leadsUrl());
    const lead = (res.json().leads as { name: string; itemName: string | null }[]).find(
      (l) => l.name === "Dana Quote",
    );
    expect(lead?.itemName).toBe("Wedding cake");
  });
});
