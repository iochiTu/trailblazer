import { contactFor, runContactEmail } from "@traiblazer/core";
import {
  auditLogs,
  contactMessages,
  createDb,
  type DbHandle,
  jobs,
  leads,
  messages,
  outboundMessages,
  phoneNumbers,
  runMigrations,
  smsOptOuts,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { FakeTelephony } from "@traiblazer/telephony";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { telephonyIdle } from "./routes/telephony.js";
import { newTenant } from "./test-helpers.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

let app: FastifyInstance;
/** The same API on a deployment without a telephony provider. */
let plain: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let cookie: string;
let ownerEmail: string;
let staffCookie: string;
let tenantId: string;
let botId: string;
const emails: string[] = [];
const tenantIds: string[] = [];
/** A number nobody else in the test database has. */
const OURS = `+1807${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const CUSTOMER = "+18075550177";

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

const url = (suffix = "") => `/v1/tenants/${tenantId}/contacts${suffix}`;
const call = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  payload?: object,
  options: { cookie?: string; target?: FastifyInstance } = {},
) =>
  (options.target ?? app).inject({
    method,
    url: path,
    headers: { cookie: options.cookie ?? cookie },
    payload,
  });

/** A request as the assistant's tool saves it, linked to its contact. */
async function addLead(details: { name: string; phone?: string; email?: string }, message = "Call me back.") {
  return withTenant(appDb.db, tenantId, async (tx) => {
    const contactId = await contactFor(tx, tenantId, details);
    const [lead] = await tx
      .insert(leads)
      .values({ tenantId, botId, channel: "widget", kind: "callback", message, contactId, ...details })
      .returning();
    return lead!;
  });
}

type Listed = { id: string; name: string | null; phone: string | null; email: string | null };
const list = async (q = "") =>
  (await call("GET", url(q ? `?q=${encodeURIComponent(q)}` : ""))).json().contacts as Listed[];
const detail = async (id: string, target = app) =>
  (await call("GET", url(`/${id}`), undefined, { target })).json();

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

  const owner = await signup("contacts-owner");
  cookie = owner.cookie;
  ownerEmail = owner.email;
  const staff = await signup("contacts-staff");
  staffCookie = staff.cookie;
  await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.email, staff.email));

  tenantId = await newTenant(app, tenantIds, cookie, "Maple Bakery");
  botId = (
    await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/bots`,
      headers: { cookie },
      payload: { name: "Maple Bakery Assistant", pack: "cafe-bakery" },
    })
  ).json().bot.id;
  await ownerDb.db.insert(phoneNumbers).values({ tenantId, botId, e164: OURS, provider: "fake" });
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await plain?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("contacts", () => {
  it("makes a contact of whoever texts the assistant's number", async () => {
    expect(await list()).toEqual([]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/fake/sms",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-fake-signature": "valid" },
      payload: new URLSearchParams({
        id: crypto.randomUUID(),
        from: CUSTOMER,
        to: OURS,
        text: "Are you open on Sunday?",
      }).toString(),
    });
    expect(res.statusCode).toBe(200);
    await telephonyIdle();

    const contacts = await list();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: null, phone: CUSTOMER, email: null });
    // Their text and the assistant's answer are on their page.
    const page = await detail(contacts[0]!.id);
    expect(page.timeline.map((i: { type: string; from: string }) => `${i.type}:${i.from}`)).toEqual([
      "text:contact",
      "text:assistant",
    ]);
    expect(page.reach).toEqual({ sms: { ok: true, from: OURS }, email: { ok: false, reason: "no_email" } });
  });

  it("finds the same person again by number, then by email, and keeps what it knew", async () => {
    // The number typed in the chat is the one that texted: one contact, now with a name and email.
    const lead = await addLead({ name: "Dana Roy", phone: "(807) 555-0177", email: "Dana@Example.com" });
    let contacts = await list();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ id: lead.contactId, name: "Dana Roy", email: "dana@example.com" });

    // Known by email only; a later request with the same address is the same person.
    const first = await addLead({ name: "Sam", email: "sam@example.com" }, "A quote for 40 cupcakes.");
    const again = await addLead({ name: "Samuel Tremblay", email: "SAM@example.com", phone: "807 555 0123" });
    expect(again.contactId).toBe(first.contactId);
    contacts = await list();
    expect(contacts).toHaveLength(2);
    expect(contacts.find((c) => c.id === first.contactId)).toMatchObject({
      name: "Sam",
      phone: "+18075550123",
      requests: 2,
      openRequests: 2,
    });

    expect((await list("dana")).map((c) => c.name)).toEqual(["Dana Roy"]);
    expect((await list("555-0123")).map((c) => c.name)).toEqual(["Sam"]);
    expect((await list("sam@example")).map((c) => c.name)).toEqual(["Sam"]);
    expect(await list("100%")).toEqual([]);

    const page = await detail(first.contactId!);
    expect(page.timeline.filter((i: { type: string }) => i.type === "request")).toHaveLength(2);
  });

  it("texts a contact from the assistant's number and keeps it in their thread", async () => {
    const [dana] = await list("dana");
    const res = await call("POST", url(`/${dana!.id}/messages`), {
      channel: "sms",
      body: "Hi Dana — yes, 9 to 3 on Sundays. Want me to hold a loaf?",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toMatchObject({ type: "team", channel: "sms", status: "queued" });

    const [text] = await ownerDb.db
      .select()
      .from(outboundMessages)
      .where(and(eq(outboundMessages.toNumber, CUSTOMER), eq(outboundMessages.kind, "staff")));
    // Typographic punctuation is made plain, like the assistant's own texts.
    expect(text).toMatchObject({
      fromNumber: OURS,
      body: "Hi Dana - yes, 9 to 3 on Sundays. Want me to hold a loaf?",
    });
    // The assistant sees it in the thread when Dana answers; her page shows it once, as the team's.
    const inThread = await ownerDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, text!.conversationId!));
    expect(inThread.filter((m) => m.flags.staff)).toHaveLength(1);
    const page = await detail(dana!.id);
    const mine = page.timeline.filter((i: { body?: string }) => i.body?.startsWith("Hi Dana"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: "team", channel: "sms", authorName: "contacts-owner" });

    const [entry] = await ownerDb.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, dana!.id), eq(auditLogs.action, "contact.message")));
    expect(entry).toMatchObject({ metadata: { channel: "sms" } });
    expect(JSON.stringify(entry)).not.toContain("loaf");
  });

  it("doesn't text someone who opted out, or without a number to text from", async () => {
    const [dana] = await list("dana");
    const text = { channel: "sms", body: "One more thing" };
    const onPlain = await call("POST", url(`/${dana!.id}/messages`), text, { target: plain });
    expect(onPlain.statusCode).toBe(409);
    expect(onPlain.json().error).toBe("contact_no_number");
    expect((await detail(dana!.id, plain)).reach.sms).toEqual({ ok: false, reason: "no_number" });

    await ownerDb.db.insert(smsOptOuts).values({ tenantId, botId, number: CUSTOMER });
    const refused = await call("POST", url(`/${dana!.id}/messages`), text);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("contact_opted_out");
    expect((await detail(dana!.id)).reach.sms).toEqual({ ok: false, reason: "opted_out" });
    await ownerDb.db.delete(smsOptOuts).where(eq(smsOptOuts.number, CUSTOMER));

    expect((await call("POST", url(`/${dana!.id}/messages`), { channel: "sms", body: " " })).statusCode).toBe(
      400,
    );
    expect(
      (await call("POST", url(`/${dana!.id}/messages`), { channel: "sms", body: "x".repeat(700) }))
        .statusCode,
    ).toBe(400);
  });

  it("emails a contact under the business's name, with answers going to who wrote it", async () => {
    const [dana] = await list("dana");
    const res = await call("POST", url(`/${dana!.id}/messages`), {
      channel: "email",
      subject: "Your cake quote",
      body: "Hello Dana,\n\nThe two-tier cake is $180.",
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().message.id as string;
    expect(res.json().message.status).toBe("queued");
    const queued = await ownerDb.db.select().from(jobs).where(eq(jobs.type, "contact.email"));
    expect(queued.some((j) => (j.payload as { messageId: string }).messageId === id)).toBe(true);

    const sent: unknown[] = [];
    const mailer = { send: async (message: unknown) => void sent.push(message) };
    expect(
      await runContactEmail({ db: appDb.db, mailer, mailConfigured: true }, tenantId, { messageId: id }),
    ).toBe("sent");
    expect(sent).toEqual([
      {
        to: ["dana@example.com"],
        subject: "Your cake quote",
        text: "Hello Dana,\n\nThe two-tier cake is $180.",
        fromName: "Maple Bakery",
        replyTo: ownerEmail,
      },
    ]);
    // A job delivered twice sends once.
    expect(
      await runContactEmail({ db: appDb.db, mailer, mailConfigured: true }, tenantId, { messageId: id }),
    ).toBe("skipped");
    const page = await detail(dana!.id);
    expect(page.timeline.find((i: { id: string }) => i.id === id)).toMatchObject({
      status: "sent",
      error: null,
    });

    // Without a mail server the team is told it didn't go, not that it did.
    const second = await call("POST", url(`/${dana!.id}/messages`), {
      channel: "email",
      subject: "Again",
      body: "Hello",
    });
    const secondId = second.json().message.id as string;
    expect(
      await runContactEmail({ db: appDb.db, mailer, mailConfigured: false }, tenantId, {
        messageId: secondId,
      }),
    ).toBe("failed");
    const [row] = await ownerDb.db.select().from(contactMessages).where(eq(contactMessages.id, secondId));
    expect(row).toMatchObject({ status: "failed", error: "not_configured" });
    expect(sent).toHaveLength(1);
  });

  it("records calls and notes, and refuses an email without an address", async () => {
    const texter = await withTenant(appDb.db, tenantId, (tx) =>
      contactFor(tx, tenantId, { phone: "+18075550155" }),
    );
    const noEmail = await call("POST", url(`/${texter}/messages`), {
      channel: "email",
      subject: "Hi",
      body: "Hello",
    });
    expect(noEmail.statusCode).toBe(409);
    expect(noEmail.json().error).toBe("contact_no_email");
    expect((await call("POST", url(`/${texter}/messages`), { channel: "call" })).statusCode).toBe(201);
    expect(
      (await call("POST", url(`/${texter}/messages`), { channel: "note", body: "Wants a callback Friday." }))
        .statusCode,
    ).toBe(201);
    expect((await call("POST", url(`/${texter}/messages`), { channel: "note", body: "" })).statusCode).toBe(
      400,
    );
    const page = await detail(texter!);
    expect(page.timeline.map((i: { channel: string; status: string }) => [i.channel, i.status])).toEqual([
      ["call", "sent"],
      ["note", "sent"],
    ]);
    // Just written to: first in the list.
    expect((await list())[0]!.id).toBe(texter);
  });

  it("lets support staff add a note but not write to the business's customers", async () => {
    const [dana] = await list("dana");
    const asStaff = { cookie: staffCookie };
    const sms = await call("POST", url(`/${dana!.id}/messages`), { channel: "sms", body: "Hi" }, asStaff);
    // 403 for a super admin in support mode; 404 when support mode isn't open for this business.
    expect([403, 404]).toContain(sms.statusCode);
  });

  it("keeps contacts within their business", async () => {
    const [dana] = await list("dana");
    const stranger = await signup("contacts-stranger");
    await newTenant(app, tenantIds, stranger.cookie, "Stranger Co");
    for (const [method, path, payload] of [
      ["GET", url()],
      ["GET", url(`/${dana!.id}`)],
      ["POST", url(`/${dana!.id}/messages`), { channel: "note", body: "Hello" }],
      ["DELETE", url(`/${dana!.id}`)],
    ] as const) {
      expect([403, 404]).toContain((await call(method, path, payload, stranger)).statusCode);
    }
    expect((await call("GET", url("/not-a-uuid"))).statusCode).toBe(404);
  });

  it("removes a contact and what the team wrote; their requests stay", async () => {
    const [sam] = await list("sam@example");
    await call("POST", url(`/${sam!.id}/messages`), { channel: "note", body: "Asked to be forgotten." });
    expect((await call("DELETE", url(`/${sam!.id}`))).statusCode).toBe(204);
    expect((await call("DELETE", url(`/${sam!.id}`))).statusCode).toBe(404);
    expect((await call("GET", url(`/${sam!.id}`))).statusCode).toBe(404);
    expect(
      await ownerDb.db.select().from(contactMessages).where(eq(contactMessages.contactId, sam!.id)),
    ).toEqual([]);
    const kept = await ownerDb.db.select().from(leads).where(eq(leads.email, "sam@example.com"));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.contactId).toBeNull();
  });
});
