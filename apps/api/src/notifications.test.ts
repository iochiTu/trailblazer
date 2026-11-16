import {
  auditLogs,
  createDb,
  type DbHandle,
  jobs,
  leads,
  memberships,
  pushDevices,
  runMigrations,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
let botA: string;
let botB: string;
const emails: string[] = [];
const tenantIds: string[] = [];

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
const call = (method: Method, url: string, payload?: unknown, sessionCookie = cookie) =>
  app.inject({ method, url, headers: { cookie: sessionCookie }, payload: payload as object | undefined });

async function createBot(name: string, pack = "trades") {
  const res = await call("POST", `/v1/tenants/${tenantId}/bots`, { name, pack });
  return res.json().bot.id as string;
}

const addLead = async (bot: string, name: string, extra: Partial<typeof leads.$inferInsert> = {}) =>
  (
    await withTenant(appDb.db, tenantId, (tx) =>
      tx
        .insert(leads)
        .values({
          tenantId,
          botId: bot,
          channel: "hosted",
          kind: "callback",
          name,
          phone: "807-555-0100",
          message: "Furnace is making a noise.",
          ...extra,
        })
        .returning(),
    )
  )[0]!;

const userIdOf = async (sessionCookie: string) =>
  (await call("GET", "/v1/auth/me", undefined, sessionCookie)).json().user.id as string;

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
    VAPID_PUBLIC_KEY: "BPublicVapidKeyForTests",
  } as NodeJS.ProcessEnv);
  app = await buildApp({ db: appDb.db, config, gateway: createGatewayFromEnv({}).gateway });
  cookie = await newUser(app, emails, "inbox-owner");
  tenantId = await newTenant(app, tenantIds, cookie, "North Heating");
  botA = await createBot("North Heating");
  botB = await createBot("North Plumbing");
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("push devices", () => {
  const ios = { platform: "ios", token: "apns-device-token-1234", appVersion: "1.0.0" };

  it("gives browsers the public Web Push key", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/push/config" })).json()).toEqual({
      webPushPublicKey: "BPublicVapidKeyForTests",
    });
  });

  it("registers a phone once, moves it to whoever signs in on it, and checks web subscriptions", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/me/devices", payload: ios })).statusCode).toBe(401);
    const first = await call("POST", "/v1/me/devices", ios);
    expect(first.statusCode).toBe(201);
    expect(first.json().device).toMatchObject({ platform: "ios" });
    // Every app start registers again: still one row.
    const again = await call("POST", "/v1/me/devices", ios);
    expect(again.json().device.id).toBe(first.json().device.id);

    const other = await newUser(app, emails, "inbox-other");
    await call("POST", "/v1/me/devices", ios, other);
    const rows = await ownerDb.db.select().from(pushDevices).where(eq(pushDevices.token, ios.token));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(await userIdOf(other));

    // Only its owner can remove it.
    expect((await call("DELETE", `/v1/me/devices/${rows[0]!.id}`)).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/me/devices/${rows[0]!.id}`, undefined, other)).statusCode).toBe(204);

    const web = {
      platform: "web",
      token: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "BKey", auth: "secret" },
    };
    expect((await call("POST", "/v1/me/devices", web)).statusCode).toBe(201);
    expect(
      (await call("POST", "/v1/me/devices", { ...web, token: "http://insecure.example/x" })).statusCode,
    ).toBe(400);
    expect((await call("POST", "/v1/me/devices", { platform: "web", token: web.token })).statusCode).toBe(
      400,
    );
    expect((await call("POST", "/v1/me/devices", { platform: "fax", token: "12345678" })).statusCode).toBe(
      400,
    );
  });

  it("stops pushes to a phone when its user signs out there", async () => {
    const phone = await newUser(app, emails, "inbox-phone");
    await call("POST", "/v1/me/devices", { platform: "android", token: "fcm-token-signout-test" }, phone);
    await call("POST", "/v1/auth/logout", undefined, phone);
    const rows = await ownerDb.db
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.token, "fcm-token-signout-test"));
    expect(rows).toEqual([]);
  });
});

describe("notification preferences", () => {
  it("starts with everything on and saves the user's choices", async () => {
    expect((await call("GET", "/v1/me/notification-prefs")).json().prefs).toEqual({
      events: {},
      quietStart: null,
      quietEnd: null,
      timeZone: null,
      urgentInQuietHours: true,
    });
    const prefs = {
      events: { "request.new": false },
      quietStart: "21:30",
      quietEnd: "06:30",
      timeZone: "America/Toronto",
      urgentInQuietHours: true,
    };
    expect((await call("PUT", "/v1/me/notification-prefs", prefs)).statusCode).toBe(200);
    expect((await call("GET", "/v1/me/notification-prefs")).json().prefs).toEqual(prefs);

    for (const bad of [
      { ...prefs, quietEnd: null },
      { ...prefs, quietStart: "25:00" },
      { ...prefs, timeZone: "Mars/Olympus" },
      { ...prefs, events: { "request.everything": false } },
    ]) {
      expect((await call("PUT", "/v1/me/notification-prefs", bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("inbox and request notes", () => {
  it("lists every assistant's requests, urgent ones still to do first, without test requests", async () => {
    await addLead(botA, "Older", { createdAt: new Date(Date.now() - 120_000) });
    await addLead(botB, "Urgent", { urgent: true, createdAt: new Date(Date.now() - 300_000) });
    await addLead(botA, "Newest");
    await addLead(botA, "Finished", { status: "done" });
    await addLead(botA, "My test", { channel: "playground" });

    const inbox = (await call("GET", `/v1/tenants/${tenantId}/inbox`)).json();
    expect(inbox.leads.map((l: { name: string }) => l.name)).toEqual(["Urgent", "Newest", "Older"]);
    expect(inbox).toMatchObject({ newCount: 3, urgentCount: 1 });
    expect(inbox.leads[0]).toMatchObject({ botId: botB, botName: "North Plumbing", comments: 0 });

    const done = (await call("GET", `/v1/tenants/${tenantId}/inbox?status=done`)).json();
    expect(done.leads.map((l: { name: string }) => l.name)).toEqual(["Finished"]);
    expect((await call("GET", `/v1/tenants/${tenantId}/inbox?status=nope`)).statusCode).toBe(400);

    const stranger = await newUser(app, emails, "inbox-stranger");
    expect((await call("GET", `/v1/tenants/${tenantId}/inbox`, undefined, stranger)).statusCode).toBe(404);
  });

  it("adds notes to a request, tells the rest of the team, and keeps the text out of the audit log", async () => {
    const lead = await addLead(botA, "Noted");
    const url = `/v1/tenants/${tenantId}/bots/${botA}/leads/${lead.id}`;

    const res = await call("POST", `${url}/comments`, { body: "  Called back, coming Tuesday at 9  " });
    expect(res.statusCode).toBe(201);
    expect(res.json().comment).toMatchObject({
      body: "Called back, coming Tuesday at 9",
      authorName: "inbox-owner",
    });
    expect((await call("POST", `${url}/comments`, { body: "   " })).statusCode).toBe(400);
    expect((await call("POST", `${url}/comments`, { body: "x".repeat(2001) })).statusCode).toBe(400);

    const detail = (await call("GET", url)).json();
    expect(detail.lead).toMatchObject({
      id: lead.id,
      name: "Noted",
      botName: "North Heating",
      comments: 1,
      booking: null,
    });
    expect(detail.comments).toEqual([
      expect.objectContaining({ body: "Called back, coming Tuesday at 9", authorName: "inbox-owner" }),
    ]);
    // Asked from the wrong assistant: not found.
    expect((await call("GET", `/v1/tenants/${tenantId}/bots/${botB}/leads/${lead.id}`)).statusCode).toBe(404);

    const [job] = await ownerDb.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, "push.notify")));
    expect(job!.payload).toMatchObject({
      event: "request.comment",
      botId: botA,
      leadId: lead.id,
      commentId: res.json().comment.id,
      actorUserId: await userIdOf(cookie),
    });
    const [entry] = await ownerDb.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, lead.id), eq(auditLogs.action, "lead.comment")));
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain("Tuesday");
  });

  it("lets view-only members read notes but not add them", async () => {
    const lead = await addLead(botA, "Viewer");
    const viewer = await newUser(app, emails, "inbox-viewer");
    await ownerDb.db.insert(memberships).values({ tenantId, userId: await userIdOf(viewer), role: "viewer" });
    const url = `/v1/tenants/${tenantId}/bots/${botA}/leads/${lead.id}`;
    expect((await call("GET", url, undefined, viewer)).statusCode).toBe(200);
    expect((await call("POST", `${url}/comments`, { body: "hi" }, viewer)).statusCode).toBe(403);
  });
});
