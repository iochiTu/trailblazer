import {
  auditLogs,
  createDb,
  type DbHandle,
  outboundMessages,
  phoneNumbers,
  runMigrations,
  smsOptOuts,
  tenants,
  users,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { FakeTelephony } from "@traiblazer/telephony";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { telephonyIdle } from "./routes/telephony.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let app: FastifyInstance;
let plain: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let ownerCookie: string;
let staffCookie: string;
let tenantId: string;
let botId: string;
const emails: string[] = [];
const tenantIds: string[] = [];
/** A number nobody else in the test database has. */
const OURS = `+1807${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const CUSTOMER = "+18075550199";

async function signup(name: string) {
  const email = `${name}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name },
  });
  return { email, cookie: `tb_session=${res.cookies.find((c) => c.name === "tb_session")!.value}` };
}

const phoneUrl = (bot = botId) => `/v1/tenants/${tenantId}/bots/${bot}/phone`;
const api = (method: "GET" | "PUT" | "PATCH" | "DELETE", url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, payload });

/** A webhook as the provider posts it: form fields, signed. */
const webhook = (
  path: string,
  fields: Record<string, string>,
  signature: string | null = "valid",
  target = app,
) =>
  target.inject({
    method: "POST",
    url: `/v1/telephony/fake/${path}`,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(signature ? { "x-fake-signature": signature } : {}),
    },
    payload: new URLSearchParams(fields).toString(),
  });
const sent = (to = CUSTOMER) =>
  ownerDb.db
    .select()
    .from(outboundMessages)
    .where(and(eq(outboundMessages.botId, botId), eq(outboundMessages.toNumber, to)));

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
  const gateway = createGatewayFromEnv({}).gateway;
  app = await buildApp({ db: appDb.db, config, gateway, telephony: new FakeTelephony() });
  plain = await buildApp({ db: appDb.db, config, gateway });

  const owner = await signup("phone-owner");
  ownerCookie = owner.cookie;
  const staff = await signup("phone-staff");
  staffCookie = staff.cookie;
  await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.email, staff.email));

  tenantId = (
    await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: { cookie: ownerCookie },
      payload: { name: "Maple Bakery" },
    })
  ).json().tenant.id;
  tenantIds.push(tenantId);
  botId = (
    await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/bots`,
      headers: { cookie: ownerCookie },
      payload: { name: "Maple Bakery Assistant", pack: "cafe-bakery" },
    })
  ).json().bot.id;
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await plain?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("an assistant's phone number", () => {
  it("is assigned by Traiblazer staff only, and recorded", async () => {
    expect((await api("GET", phoneUrl(), ownerCookie)).json()).toEqual({
      phone: null,
      available: true,
      stats: { textsSent30Days: 0, optOuts: 0 },
      canAssign: false,
      webhooks: null,
    });
    expect((await api("GET", phoneUrl(), staffCookie)).json()).toMatchObject({
      canAssign: true,
      webhooks: {
        sms: "http://chat.test.local/v1/telephony/fake/sms",
        voice: "http://chat.test.local/v1/telephony/fake/voice",
      },
    });
    expect((await api("PUT", phoneUrl(), ownerCookie, { number: OURS })).statusCode).toBe(403);
    expect((await api("PUT", phoneUrl(), staffCookie, { number: "555-0142" })).statusCode).toBe(400);

    const res = await api("PUT", phoneUrl(), staffCookie, { number: OURS });
    expect(res.statusCode).toBe(201);
    expect(res.json().phone).toMatchObject({
      e164: OURS,
      provider: "fake",
      smsEnabled: true,
      callMode: "text_back",
    });
    expect((await api("GET", phoneUrl(), ownerCookie)).json().phone.e164).toBe(OURS);
    const logged = await ownerDb.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "phone.assigned")));
    expect(logged).toHaveLength(1);
  });

  it("can't be given to a second assistant", async () => {
    const other = (
      await app.inject({
        method: "POST",
        url: `/v1/tenants/${tenantId}/bots`,
        headers: { cookie: ownerCookie },
        payload: { name: "Second", pack: "cafe-bakery" },
      })
    ).json().bot.id as string;
    const res = await api("PUT", phoneUrl(other), staffCookie, { number: OURS });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("number_taken");
  });

  it("lets the business decide what texts and calls do", async () => {
    const res = await api("PATCH", phoneUrl(), ownerCookie, { callMode: "off" });
    expect(res.json().phone).toMatchObject({ callMode: "off", smsEnabled: true });
    expect((await api("PATCH", phoneUrl(), ownerCookie, { callMode: "answer" })).statusCode).toBe(400);
    await api("PATCH", phoneUrl(), ownerCookie, { callMode: "text_back" });
  });
});

describe("webhooks from the telephony provider", () => {
  it("exist only when a provider is configured, and need its signature", async () => {
    expect((await webhook("sms", { from: CUSTOMER, to: OURS, text: "Hi" }, "valid", plain)).statusCode).toBe(
      404,
    );
    expect((await webhook("sms", { from: CUSTOMER, to: OURS, text: "Hi" }, null)).statusCode).toBe(403);
    expect((await webhook("voice", { from: CUSTOMER, to: OURS }, "forged")).statusCode).toBe(403);
    expect((await webhook("status", { id: "x", status: "delivered" }, "forged")).statusCode).toBe(403);
    await telephonyIdle();
    expect(await sent()).toEqual([]);
  });

  it("answers a text once, even when the webhook is delivered twice", async () => {
    const fields = { id: "in-1", from: CUSTOMER, to: OURS, text: "Are you open on Sunday?" };
    const first = await webhook("sms", fields);
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe("");
    await webhook("sms", fields);
    await telephonyIdle();
    const out = await sent();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "reply", fromNumber: OURS, status: "queued" });
    expect(out[0]!.body.length).toBeGreaterThan(0);
  });

  it("ignores texts to an unknown number, and when texting is turned off", async () => {
    await webhook("sms", { id: "in-2", from: CUSTOMER, to: "+18075550000", text: "Hello" });
    await api("PATCH", phoneUrl(), ownerCookie, { smsEnabled: false });
    await webhook("sms", { id: "in-3", from: CUSTOMER, to: OURS, text: "Hello" });
    await telephonyIdle();
    expect(await sent()).toHaveLength(1);
    await api("PATCH", phoneUrl(), ownerCookie, { smsEnabled: true });
  });

  it("records STOP without answering", async () => {
    await webhook("sms", { id: "in-4", from: "+18075550188", to: OURS, text: "STOP" });
    await telephonyIdle();
    expect(await sent("+18075550188")).toEqual([]);
    const stopped = await ownerDb.db.select().from(smsOptOuts).where(eq(smsOptOuts.botId, botId));
    expect(stopped.map((s) => s.number)).toEqual(["+18075550188"]);
  });

  it("answers a call with one sentence and texts the caller", async () => {
    const caller = "+18075550177";
    const res = await webhook("voice", { from: caller, to: OURS });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/^say\(en\): Thanks for calling Maple Bakery/);
    const out = await sent(caller);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "text_back" });

    // Calls are refused for an unknown number, and when the business turned them off.
    expect((await webhook("voice", { from: caller, to: "+18075550000" })).body).toBe("reject");
    await api("PATCH", phoneUrl(), ownerCookie, { callMode: "off" });
    expect((await webhook("voice", { from: caller, to: OURS })).body).toBe("reject");
    await api("PATCH", phoneUrl(), ownerCookie, { callMode: "text_back" });
  });

  it("updates a text from its delivery report", async () => {
    const [message] = await sent();
    await ownerDb.db
      .update(outboundMessages)
      .set({ status: "sent", providerId: "prov-1" })
      .where(eq(outboundMessages.id, message!.id));
    const report = (query: string) => webhook(`status?${query}`, { id: "prov-1", status: "delivered" });
    expect((await report(`t=${tenantId}&m=${message!.id}`)).statusCode).toBe(204);
    expect((await sent())[0]).toMatchObject({ status: "delivered" });
    // A report without the message it belongs to changes nothing.
    expect((await report("t=nope&m=nope")).statusCode).toBe(204);
  });

  it("stops answering when staff take the number away", async () => {
    expect((await api("DELETE", phoneUrl(), ownerCookie)).statusCode).toBe(403);
    expect((await api("DELETE", phoneUrl(), staffCookie)).statusCode).toBe(204);
    expect(await ownerDb.db.select().from(phoneNumbers).where(eq(phoneNumbers.botId, botId))).toEqual([]);
    await webhook("sms", { id: "in-9", from: CUSTOMER, to: OURS, text: "Hello again" });
    await telephonyIdle();
    expect(await sent()).toHaveLength(1);
  });
});
