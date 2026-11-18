import {
  auditLogs,
  createDb,
  type DbHandle,
  jobs,
  leads,
  runMigrations,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { newTenant, newUser } from "./test-helpers.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let cookie: string;
let tenantId: string;
let botId: string;
const gateway = createGatewayFromEnv({}).gateway;
const emails: string[] = [];
const tenantIds: string[] = [];

const signup = (name: string) => newUser(app, emails, name);

const createTenant = (sessionCookie: string, name: string) => newTenant(app, tenantIds, sessionCookie, name);

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
const call = (
  method: "GET" | "PATCH" | "DELETE" | "PUT" | "POST",
  url: string,
  payload?: unknown,
  headers = { cookie },
) => app.inject({ method, url, headers, payload: payload as object | undefined });

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
  app = await buildApp({ db: appDb.db, config, gateway });

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

  it("keeps suggestions advisory and schedules only the business's saved reminder", async () => {
    const lead = await addLead("Follow-up");
    const url = leadsUrl(`/${lead.id}`);
    const review = async () =>
      (await call("GET", `/v1/tenants/${tenantId}/inbox?status=review`))
        .json()
        .leads.some((item: { id: string }) => item.id === lead.id);
    expect(await review()).toBe(true);
    const suggestion = "Check which photograph the customer can provide.";
    const routes = vi.spyOn(gateway, "routes").mockReturnValue([{ provider: "pilot", model: "test" }]);
    const complete = vi.spyOn(gateway, "complete").mockResolvedValue({
      provider: "pilot",
      model: "test",
      text: suggestion,
      stopReason: "end",
      costMicros: 0,
      usage: { inputTokens: 10, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    try {
      expect((await call("POST", `${url}/next-action/suggestion`)).json()).toEqual({ suggestion });
      expect(complete.mock.calls[0]?.[1].tools).toBeUndefined();
    } finally {
      routes.mockRestore();
      complete.mockRestore();
    }
    expect((await call("GET", url)).json().lead).toMatchObject({ nextAction: null, actionVersion: 0 });
    const action = {
      text: "Wait for the photo",
      waitingOn: "customer",
      dueAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const set = (version: number) => call("PUT", `${url}/next-action`, { version, action });
    const concurrent = await Promise.all([set(0), set(0)]);
    expect(concurrent.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    expect(await review()).toBe(false);
    expect((await call("GET", url)).json().lead).toMatchObject({ nextAction: action });
    const queued = await ownerDb.db.select().from(jobs).where(eq(jobs.tenantId, tenantId));
    expect(queued.filter((job) => job.payload.leadId === lead.id)).toEqual([
      expect.objectContaining({
        type: "push.notify",
        runAt: new Date(action.dueAt),
        payload: { event: "request.reminder", leadId: lead.id, botId, actionVersion: 1 },
      }),
    ]);
    expect((await call("PUT", `${url}/next-action`, { version: 1, action: null })).statusCode).toBe(200);
    expect(await review()).toBe(true);
    await set(2);
    await call("PATCH", url, { status: "done" });
    expect((await set(3)).statusCode).toBe(409);
    expect(await review()).toBe(false);
    await call("PATCH", url, { status: "new" });
    expect(await review()).toBe(true);
    const [entry] = await ownerDb.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, lead.id), eq(auditLogs.action, "lead.next_action")));
    expect(entry?.actorUserId).toBeTruthy();
    expect(JSON.stringify(entry)).not.toContain(action.text);
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
