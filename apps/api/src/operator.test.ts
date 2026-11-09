import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  auditLogs,
  createDb,
  type DbHandle,
  memberships,
  operatorAuditLogs,
  plans,
  platformSettings,
  runMigrations,
  tenants,
  users,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const PUBLIC = "http://chat.test.local";
const TEST_PLAN = `t_${crypto.randomUUID().slice(0, 8)}`;

let appDb: DbHandle;
let ownerDb: DbHandle;
let app: FastifyInstance;
let operatorCookie: string;
let ownerCookie: string;
let operatorId: string;
let tenantId: string;
let publicKey: string;
let botId: string;
const emails: string[] = [];
const tenantIds: string[] = [];
let savedSettings: (typeof platformSettings.$inferSelect)[] = [];

const config = loadConfig({
  NODE_ENV: "test",
  AUTH_RATE_LIMIT_PER_MIN: "1000",
  CHAT_RATE_LIMIT_PER_MIN: "1000",
  PUBLIC_URL: PUBLIC,
  // Settings are changed directly in the database below too, so don't cache them.
  PLATFORM_CACHE_SECONDS: "0",
} as NodeJS.ProcessEnv);

async function signup(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name: prefix },
  });
  return {
    email,
    id: res.json().user.id as string,
    cookie: `tb_session=${res.cookies.find((c) => c.name === "tb_session")!.value}`,
  };
}

const op = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, cookie = operatorCookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const createTenant = async (name: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/tenants",
    headers: { cookie: ownerCookie },
    payload: { name },
  });
  tenantIds.push(res.json().tenant.id);
  return res.json().tenant as { id: string; plan: string };
};

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  savedSettings = await ownerDb.db.select().from(platformSettings);
  app = await buildApp({
    db: appDb.db,
    config,
    gateway: createGatewayFromEnv({}).gateway,
    chatDistDir: await mkdtemp(path.join(tmpdir(), "tb-chat-")),
  });

  const operator = await signup("operator");
  operatorCookie = operator.cookie;
  operatorId = operator.id;
  await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, operatorId));

  const owner = await signup("owner");
  ownerCookie = owner.cookie;
  tenantId = (await createTenant("Northshore Outfitters")).id;
  const bot = await app.inject({
    method: "POST",
    url: `/v1/tenants/${tenantId}/bots`,
    headers: { cookie: ownerCookie },
    payload: { name: "Outfitters Assistant", pack: "retail", hostedPageEnabled: true },
  });
  publicKey = bot.json().keys[0].publicKey;
  botId = bot.json().bot.id;
});

afterAll(async () => {
  if (ownerDb) {
    // Platform settings and plans are shared by every test file: put them back.
    await ownerDb.db.delete(platformSettings);
    if (savedSettings.length) await ownerDb.db.insert(platformSettings).values(savedSettings);
    await ownerDb.db.delete(tenants).where(inArray(tenants.id, tenantIds));
    await ownerDb.db.delete(plans).where(eq(plans.id, TEST_PLAN));
    await ownerDb.db.delete(operatorAuditLogs).where(eq(operatorAuditLogs.actorUserId, operatorId));
    await ownerDb.db.delete(users).where(inArray(users.email, emails));
  }
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("operator console API", () => {
  it("is invisible to everyone but operators", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/operator/overview" })).statusCode).toBe(401);
    for (const url of [
      "/v1/operator/overview",
      "/v1/operator/tenants",
      "/v1/operator/plans",
      "/v1/operator/policies",
    ]) {
      expect((await op("GET", url, undefined, ownerCookie)).statusCode).toBe(404);
    }
    expect(
      (await op("PATCH", "/v1/operator/policies", { releasedPackPhase: 4 }, ownerCookie)).statusCode,
    ).toBe(404);
    const me = await op("GET", "/v1/auth/me");
    expect(me.json().user.platformRole).toBe("super_admin");
    expect((await op("GET", "/v1/auth/me", undefined, ownerCookie)).json().user.platformRole).toBeNull();
  });

  it("lists businesses with owners and an overview", async () => {
    const overview = (await op("GET", "/v1/operator/overview")).json();
    expect(overview.businesses).toBeGreaterThanOrEqual(1);
    expect(overview.assistants).toBeGreaterThanOrEqual(1);
    const list = (await op("GET", "/v1/operator/tenants?q=northshore")).json().tenants;
    const row = list.find((t: { id: string }) => t.id === tenantId);
    expect(row).toMatchObject({ name: "Northshore Outfitters", status: "active", assistants: 1 });
    expect(row.owners).toEqual([emails[1]]);
    expect(row.monthlyLimit).toBeGreaterThan(0);
  });

  it("creates and edits plans, and plan changes apply to businesses", async () => {
    const created = await op("POST", "/v1/operator/plans", {
      id: TEST_PLAN,
      nameEn: "Test plan",
      nameFr: "Forfait test",
      monthlyQuestions: 7,
      concurrent: 2,
      perMinute: 5,
    });
    expect(created.statusCode).toBe(201);
    expect((await op("POST", "/v1/operator/plans", { ...created.json().plan })).statusCode).toBe(409);

    expect((await op("PATCH", `/v1/operator/tenants/${tenantId}`, { plan: "nope" })).statusCode).toBe(400);
    expect((await op("PATCH", `/v1/operator/tenants/${tenantId}`, { plan: TEST_PLAN })).statusCode).toBe(200);
    const usage = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tenantId}/usage`,
      headers: { cookie: ownerCookie },
    });
    expect(usage.json().limits.effectiveMonthlyLimit).toBe(7);

    expect((await op("PATCH", `/v1/operator/plans/${TEST_PLAN}`, { monthlyQuestions: 9 })).statusCode).toBe(
      200,
    );
    const after = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tenantId}/usage`,
      headers: { cookie: ownerCookie },
    });
    expect(after.json().limits.effectiveMonthlyLimit).toBe(9);

    const listed = (await op("GET", "/v1/operator/plans")).json().plans;
    expect(listed.find((p: { id: string }) => p.id === TEST_PLAN).businesses).toBe(1);
  });

  it("guards the default plan and applies policies", async () => {
    expect((await op("PATCH", "/v1/operator/policies", { defaultPlan: "missing_plan" })).statusCode).toBe(
      400,
    );
    expect((await op("PATCH", "/v1/operator/policies", { defaultPlan: TEST_PLAN })).statusCode).toBe(200);
    expect((await createTenant("New Default Co")).plan).toBe(TEST_PLAN);
    // Can't archive the plan new businesses get.
    expect((await op("PATCH", `/v1/operator/plans/${TEST_PLAN}`, { active: false })).statusCode).toBe(400);

    // Phase-2 packs only become selectable once released.
    const tryPack = () =>
      app.inject({
        method: "POST",
        url: `/v1/tenants/${tenantId}/bots`,
        headers: { cookie: ownerCookie },
        payload: { name: "Market", pack: "grocery-market" },
      });
    expect((await tryPack()).statusCode).toBe(400);
    const released = await op("PATCH", "/v1/operator/policies", {
      releasedPackPhase: 2,
      visitorDailyLimit: 12,
    });
    expect(released.json().policies).toMatchObject({ releasedPackPhase: 2, visitorDailyLimit: 12 });
    expect((await tryPack()).statusCode).toBe(201);
    const catalog = await app.inject({
      method: "GET",
      url: "/v1/catalog/packs",
      headers: { cookie: ownerCookie },
    });
    expect(JSON.stringify(catalog.json())).toContain("grocery-market");

    expect((await op("PATCH", "/v1/operator/policies", { chatIpPerMinute: 0 })).statusCode).toBe(400);
    expect((await op("PATCH", "/v1/operator/policies", { maxBusinessesPerAccount: 0 })).statusCode).toBe(400);
  });

  it("suspending a business takes its assistants offline", async () => {
    const configUrl = `/v1/public/bots/${publicKey}`;
    expect((await app.inject({ method: "GET", url: configUrl })).statusCode).toBe(200);
    await op("PATCH", `/v1/operator/tenants/${tenantId}`, { status: "suspended" });
    expect((await app.inject({ method: "GET", url: configUrl })).statusCode).toBe(404);
    const chat = await app.inject({
      method: "POST",
      url: "/v1/public/chat",
      headers: { origin: PUBLIC },
      payload: { publicKey, visitorId: "visitor-bbbb", message: "Hi", channel: "hosted" },
    });
    expect(chat.statusCode).toBe(404);
    await op("PATCH", `/v1/operator/tenants/${tenantId}`, { status: "active" });
    expect((await app.inject({ method: "GET", url: configUrl })).statusCode).toBe(200);
  });

  it("records every change in the audit log", async () => {
    const entries = (await op("GET", "/v1/operator/audit")).json().entries as {
      action: string;
      actor: string;
      targetId: string;
    }[];
    const mine = entries.filter((e) => e.actor === emails[0]);
    const actions = new Set(mine.map((e) => e.action));
    expect(actions).toEqual(new Set(["plan.created", "plan.updated", "tenant.updated", "policies.updated"]));
    expect(mine.some((e) => e.action === "tenant.updated" && e.targetId === tenantId)).toBe(true);
  });
});

describe("staff accounts and support access", () => {
  it("keeps staff accounts out of businesses", async () => {
    const res = await op("POST", "/v1/tenants", { name: "Staff Side Project" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("staff_account");
    // The database refuses it too, whichever side changes.
    await expect(
      ownerDb.db.insert(memberships).values({ tenantId, userId: operatorId, role: "viewer" }),
    ).rejects.toThrow();
    const [owner] = await ownerDb.db.select().from(users).where(eq(users.email, emails[1]!));
    await expect(
      ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, owner!.id)),
    ).rejects.toThrow();
  });

  it("shows all users and a business's assistants", async () => {
    const list = (await op("GET", "/v1/operator/users?q=northshore")).json().users;
    const owner = list.find((u: { email: string }) => u.email === emails[1]);
    expect(owner.businesses).toContainEqual({ id: tenantId, name: "Northshore Outfitters", role: "owner" });
    expect(owner.platformRole).toBeNull();
    const staff = (await op("GET", "/v1/operator/users"))
      .json()
      .users.find((u: { email: string }) => u.email === emails[0]);
    expect(staff).toMatchObject({ platformRole: "super_admin", businesses: [] });
    expect((await op("GET", "/v1/operator/users", undefined, ownerCookie)).statusCode).toBe(404);

    const detail = (await op("GET", `/v1/operator/tenants/${tenantId}`)).json();
    expect(detail.members).toEqual([expect.objectContaining({ email: emails[1], role: "owner" })]);
    // The retail assistant plus the grocery one created when phase 2 was released above.
    expect(detail.assistants).toHaveLength(2);
    expect(detail.assistants).toContainEqual(
      expect.objectContaining({ id: botId, name: "Outfitters Assistant", pack: "retail", sources: 0 }),
    );
  });

  it("lets super admins help a business, and the business sees it in its audit log", async () => {
    const tenant = await op("GET", `/v1/tenants/${tenantId}`);
    expect(tenant.json().tenant).toMatchObject({ role: "admin", support: true });
    const owned = await op("GET", `/v1/tenants/${tenantId}`, undefined, ownerCookie);
    expect(owned.json().tenant).toMatchObject({ role: "owner", support: false });

    const edit = await op("PATCH", `/v1/tenants/${tenantId}/bots/${botId}`, { name: "Outfitters Helper" });
    expect(edit.statusCode).toBe(200);
    const entries = await ownerDb.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "support.change")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUserId: operatorId,
      metadata: { method: "PATCH", route: "/v1/tenants/:tenantId/bots/:botId" },
    });
    const [opEntry] = await ownerDb.db
      .select()
      .from(operatorAuditLogs)
      .where(
        and(eq(operatorAuditLogs.actorUserId, operatorId), eq(operatorAuditLogs.action, "support.change")),
      );
    expect(opEntry?.targetId).toBe(tenantId);

    // Reads aren't logged; a business owner still can't reach another business.
    await op("GET", `/v1/tenants/${tenantId}/bots`);
    expect(
      await ownerDb.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "support.change"))),
    ).toHaveLength(1);
  });
});
