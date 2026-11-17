import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agencies,
  agencyAuditLogs,
  agencyMembers,
  auditLogs,
  createDb,
  type DbHandle,
  operatorAuditLogs,
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

let appDb: DbHandle;
let ownerDb: DbHandle;
let app: FastifyInstance;
const emails: string[] = [];
const tenantIds: string[] = [];
const agencyIds: string[] = [];
let operatorId: string;

const config = loadConfig({
  NODE_ENV: "test",
  AUTH_RATE_LIMIT_PER_MIN: "1000",
  CHAT_RATE_LIMIT_PER_MIN: "1000",
  PUBLIC_URL: "http://chat.test.local",
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

const call = (cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

type User = Awaited<ReturnType<typeof signup>>;
let operator: User;
let agencyOwner: User;
let agencyMember: User;
let otherAgencyOwner: User;
let outsider: User;
let agencyId: string;
let otherAgencyId: string;

/** Applies for an agency as `user` and has the operator approve it. */
async function approvedAgency(user: User, name: string) {
  const applied = await call(user.cookie, "POST", "/v1/agencies", {
    name,
    country: "ca",
    currency: "CAD",
    website: "https://agency.example",
  });
  expect(applied.statusCode).toBe(201);
  const id = applied.json().agency.id as string;
  agencyIds.push(id);
  const approved = await call(operator.cookie, "PATCH", `/v1/operator/agencies/${id}`, { status: "active" });
  expect(approved.statusCode).toBe(200);
  return id;
}

async function newClient(cookie: string, agency: string, name: string, billingMode = "client_pays") {
  const res = await call(cookie, "POST", `/v1/agencies/${agency}/clients`, { name, billingMode });
  if (res.statusCode === 201) tenantIds.push(res.json().client.id);
  return res;
}

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  app = await buildApp({
    db: appDb.db,
    config,
    gateway: createGatewayFromEnv({}).gateway,
    chatDistDir: await mkdtemp(path.join(tmpdir(), "tb-chat-")),
  });
  operator = await signup("agency-operator");
  operatorId = operator.id;
  await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, operatorId));
  agencyOwner = await signup("agency-owner");
  agencyMember = await signup("agency-member");
  otherAgencyOwner = await signup("other-agency");
  outsider = await signup("outsider");
  agencyId = await approvedAgency(agencyOwner, "Northern Web Studio");
  otherAgencyId = await approvedAgency(otherAgencyOwner, "Lakehead Digital");
});

afterAll(async () => {
  if (ownerDb) {
    const clients = agencyIds.length
      ? await ownerDb.db.select({ id: tenants.id }).from(tenants).where(inArray(tenants.agencyId, agencyIds))
      : [];
    const ids = [...new Set([...tenantIds, ...clients.map((c) => c.id)])];
    if (ids.length) await ownerDb.db.delete(tenants).where(inArray(tenants.id, ids));
    if (agencyIds.length) await ownerDb.db.delete(agencies).where(inArray(agencies.id, agencyIds));
    await ownerDb.db.delete(operatorAuditLogs).where(eq(operatorAuditLogs.actorUserId, operatorId));
    await ownerDb.db.delete(users).where(inArray(users.email, emails));
  }
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("agency applications", () => {
  it("lets a user apply once, and keeps the agency inactive until operators approve it", async () => {
    const applicant = await signup("applicant");
    const res = await call(applicant.cookie, "POST", "/v1/agencies", {
      name: "Sudbury Sites",
      country: "CA",
    });
    expect(res.statusCode).toBe(201);
    const agency = res.json().agency;
    agencyIds.push(agency.id);
    expect(agency).toMatchObject({ status: "applied", role: "owner", currency: "cad" });

    const again = await call(applicant.cookie, "POST", "/v1/agencies", { name: "Second", country: "CA" });
    expect(again.statusCode).toBe(409);

    // No clients before approval.
    expect((await newClient(applicant.cookie, agency.id, "Early Client")).statusCode).toBe(403);

    const list = await call(operator.cookie, "GET", "/v1/operator/agencies");
    expect(list.json().agencies).toContainEqual(
      expect.objectContaining({ id: agency.id, status: "applied", owners: [applicant.email] }),
    );
    expect(list.json().defaultSharePercent).toBe(30);
  });

  it("refuses staff accounts", async () => {
    const res = await call(operator.cookie, "POST", "/v1/agencies", { name: "Staff Agency", country: "CA" });
    expect(res.statusCode).toBe(403);
    await expect(
      ownerDb.db.insert(agencyMembers).values({ agencyId, userId: operatorId, role: "member" }),
    ).rejects.toThrow();
  });

  it("hides the operator agency routes from everyone else", async () => {
    expect((await call(agencyOwner.cookie, "GET", "/v1/operator/agencies")).statusCode).toBe(404);
    expect(
      (await call(agencyOwner.cookie, "PATCH", `/v1/operator/agencies/${agencyId}`, { sharePercent: 0 }))
        .statusCode,
    ).toBe(404);
  });
});

describe("agency clients", () => {
  let clientId: string;
  let publicKey: string;

  it("creates clients on the trial plan with the chosen billing mode", async () => {
    const res = await newClient(agencyOwner.cookie, agencyId, "Thunder Bay Plumbing", "agency_pays");
    expect(res.statusCode).toBe(201);
    clientId = res.json().client.id;
    const [row] = await ownerDb.db.select().from(tenants).where(eq(tenants.id, clientId));
    expect(row).toMatchObject({ agencyId, agencyBillingMode: "agency_pays", plan: "trial" });

    const list = await call(agencyOwner.cookie, "GET", `/v1/agencies/${agencyId}/clients`);
    expect(list.json().clients).toEqual([
      expect.objectContaining({ id: clientId, billingMode: "agency_pays", status: "active", owners: [] }),
    ]);
    const overview = await call(agencyOwner.cookie, "GET", `/v1/agencies/${agencyId}/overview`);
    expect(overview.json()).toMatchObject({ clients: 1, agencyPays: 1, clientPays: 0, trial: 1 });
  });

  it("lets the agency's users work inside the client, audited on both sides", async () => {
    const tenant = await call(agencyOwner.cookie, "GET", `/v1/tenants/${clientId}`);
    expect(tenant.statusCode).toBe(200);
    expect(tenant.json().tenant).toMatchObject({
      role: "admin",
      support: false,
      via: "agency",
      agency: { id: agencyId, name: "Northern Web Studio" },
    });

    const bot = await call(agencyOwner.cookie, "POST", `/v1/tenants/${clientId}/bots`, {
      name: "Plumbing Assistant",
      pack: "cafe-bakery",
    });
    expect(bot.statusCode).toBe(201);
    publicKey = bot.json().keys[0].publicKey;

    const clientEntries = await ownerDb.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, clientId), eq(auditLogs.action, "agency.change")));
    expect(clientEntries).toHaveLength(1);
    expect(clientEntries[0]).toMatchObject({ actorUserId: agencyOwner.id, metadata: { agencyId } });
    const agencyEntries = await ownerDb.db
      .select()
      .from(agencyAuditLogs)
      .where(and(eq(agencyAuditLogs.agencyId, agencyId), eq(agencyAuditLogs.action, "client.change")));
    expect(agencyEntries).toEqual([expect.objectContaining({ tenantId: clientId })]);

    // Owner-only actions stay with the business's owner.
    const checkout = await call(agencyOwner.cookie, "POST", `/v1/tenants/${clientId}/billing/checkout`, {
      plan: "starter",
    });
    expect(checkout.statusCode).toBe(403);
  });

  it("lists the agency's clients among the businesses its users can open", async () => {
    const me = await call(agencyOwner.cookie, "GET", "/v1/auth/me");
    expect(me.json().agencies).toEqual([
      expect.objectContaining({ id: agencyId, role: "owner", status: "active" }),
    ]);
    expect(me.json().tenants).toContainEqual(
      expect.objectContaining({ id: clientId, role: "admin", via: "agency" }),
    );
  });

  it("keeps clients invisible to other agencies, outsiders and the public routes", async () => {
    for (const user of [otherAgencyOwner, outsider]) {
      expect((await call(user.cookie, "GET", `/v1/tenants/${clientId}`)).statusCode).toBe(404);
      expect((await call(user.cookie, "GET", `/v1/tenants/${clientId}/bots`)).statusCode).toBe(404);
      expect((await call(user.cookie, "GET", `/v1/agencies/${agencyId}/clients`)).statusCode).toBe(404);
      expect(
        (
          await call(user.cookie, "PATCH", `/v1/agencies/${agencyId}/clients/${clientId}`, {
            status: "suspended",
          })
        ).statusCode,
      ).toBe(404);
    }
    // Another agency can't act on this client through its own agency id either.
    expect(
      (
        await call(otherAgencyOwner.cookie, "PATCH", `/v1/agencies/${otherAgencyId}/clients/${clientId}`, {
          status: "suspended",
        })
      ).statusCode,
    ).toBe(404);
    // A direct customer's business stays out of reach of every agency.
    const direct = await call(outsider.cookie, "POST", "/v1/tenants", { name: "Direct Customer" });
    tenantIds.push(direct.json().tenant.id);
    expect((await call(agencyOwner.cookie, "GET", `/v1/tenants/${direct.json().tenant.id}`)).statusCode).toBe(
      404,
    );
  });

  it("gives members the clients but not the team or branding", async () => {
    const added = await call(agencyOwner.cookie, "POST", `/v1/agencies/${agencyId}/members`, {
      email: agencyMember.email,
      role: "member",
    });
    expect(added.statusCode).toBe(201);
    expect((await call(agencyMember.cookie, "GET", `/v1/tenants/${clientId}`)).statusCode).toBe(200);
    expect((await call(agencyMember.cookie, "GET", `/v1/agencies/${agencyId}/clients`)).statusCode).toBe(200);
    expect(
      (await call(agencyMember.cookie, "PATCH", `/v1/agencies/${agencyId}/branding`, { poweredBy: "agency" }))
        .statusCode,
    ).toBe(403);
    expect((await newClient(agencyMember.cookie, agencyId, "Member Client")).statusCode).toBe(403);
    expect(
      (
        await call(agencyMember.cookie, "POST", `/v1/agencies/${agencyId}/members`, {
          email: outsider.email,
          role: "admin",
        })
      ).statusCode,
    ).toBe(403);
  });

  it("adds an existing account as the client's owner", async () => {
    const owner = await signup("client-owner");
    const missing = await call(
      agencyOwner.cookie,
      "POST",
      `/v1/agencies/${agencyId}/clients/${clientId}/owner`,
      {
        email: "nobody-here@test.local",
      },
    );
    expect(missing.statusCode).toBe(404);
    const res = await call(agencyOwner.cookie, "POST", `/v1/agencies/${agencyId}/clients/${clientId}/owner`, {
      email: owner.email,
    });
    expect(res.statusCode).toBe(201);
    const own = await call(owner.cookie, "GET", `/v1/tenants/${clientId}`);
    expect(own.json().tenant).toMatchObject({
      role: "owner",
      via: "member",
      agency: { name: "Northern Web Studio" },
    });
    // An agency-pays client's plan is the agency's to pay: its owner can't buy one.
    const billing = await call(owner.cookie, "GET", `/v1/tenants/${clientId}/billing`);
    expect(billing.json().managedBy).toBe("Northern Web Studio");
    const checkout = await call(owner.cookie, "POST", `/v1/tenants/${clientId}/billing/checkout`, {
      plan: "starter",
    });
    expect(checkout.statusCode).toBe(403);
    expect(checkout.json().error).toBe("managed_by_agency");
  });

  it("lets the agency lift its own suspensions but not the operators'", async () => {
    const url = `/v1/agencies/${agencyId}/clients/${clientId}`;
    expect((await call(agencyOwner.cookie, "PATCH", url, { status: "suspended" })).statusCode).toBe(200);
    expect((await call(agencyOwner.cookie, "PATCH", url, { status: "active" })).statusCode).toBe(200);

    await call(operator.cookie, "PATCH", `/v1/operator/tenants/${clientId}`, { status: "suspended" });
    const lift = await call(agencyOwner.cookie, "PATCH", url, { status: "active" });
    expect(lift.statusCode).toBe(403);
    expect(lift.json().error).toBe("suspended_by_operator");
    await call(operator.cookie, "PATCH", `/v1/operator/tenants/${clientId}`, { status: "active" });
  });

  it("credits the agency on its clients' pages when it chooses to", async () => {
    const config = async () =>
      (await app.inject({ method: "GET", url: `/v1/public/bots/${publicKey}` })).json().bot;

    // Not chosen yet: no credit at all (never ours on an agency's client).
    expect(await config()).toMatchObject({ poweredBy: false, poweredByAgency: null });

    const branding = await call(agencyOwner.cookie, "PATCH", `/v1/agencies/${agencyId}/branding`, {
      poweredBy: "agency",
      website: "https://northernweb.example",
      color: "#123456",
    });
    expect(branding.statusCode).toBe(200);
    expect(await config()).toMatchObject({
      poweredBy: false,
      poweredByAgency: { name: "Northern Web Studio", url: "https://northernweb.example" },
    });

    const bad = await call(agencyOwner.cookie, "PATCH", `/v1/agencies/${agencyId}/branding`, {
      logoUrl: "javascript:alert(1)",
    });
    expect(bad.statusCode).toBe(400);
  });

  it("enforces the trial cap and the billing modes operators allow", async () => {
    await call(operator.cookie, "PATCH", `/v1/operator/agencies/${otherAgencyId}`, {
      trialClientCap: 1,
      billingModes: ["client_pays"],
    });
    const wholesale = await newClient(
      otherAgencyOwner.cookie,
      otherAgencyId,
      "Wholesale Client",
      "agency_pays",
    );
    expect(wholesale.statusCode).toBe(400);
    expect((await newClient(otherAgencyOwner.cookie, otherAgencyId, "First Client")).statusCode).toBe(201);
    const second = await newClient(otherAgencyOwner.cookie, otherAgencyId, "Second Client");
    expect(second.statusCode).toBe(403);
    expect(second.json().error).toBe("trial_cap_reached");

    // A mode in use can't be turned off, and the currency can't change once there are clients.
    expect(
      (
        await call(operator.cookie, "PATCH", `/v1/operator/agencies/${otherAgencyId}`, {
          billingModes: ["agency_pays"],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call(operator.cookie, "PATCH", `/v1/operator/agencies/${otherAgencyId}`, { currency: "usd" }))
        .statusCode,
    ).toBe(409);
  });

  it("cuts off a suspended agency's users from its clients", async () => {
    await call(operator.cookie, "PATCH", `/v1/operator/agencies/${agencyId}`, { status: "suspended" });
    expect((await call(agencyOwner.cookie, "GET", `/v1/tenants/${clientId}`)).statusCode).toBe(404);
    expect((await newClient(agencyOwner.cookie, agencyId, "While Suspended")).statusCode).toBe(403);
    const me = await call(agencyOwner.cookie, "GET", "/v1/auth/me");
    expect(me.json().tenants.some((t: { id: string }) => t.id === clientId)).toBe(false);
    await call(operator.cookie, "PATCH", `/v1/operator/agencies/${agencyId}`, { status: "active" });
    expect((await call(agencyOwner.cookie, "GET", `/v1/tenants/${clientId}`)).statusCode).toBe(200);
  });
});
