import { createDb, type DbHandle, runMigrations, tenants, users } from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const PUBLIC = "http://chat.test.local";

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

const base = () => `/v1/tenants/${tenantId}/bots/${botId}`;
const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, headers = { cookie }) =>
  app.inject({ method, url, headers, payload: payload as object | undefined });
/** A visitor asks the assistant (the offline model: it answers only from the business's information). */
const ask = (message: string) =>
  app.inject({
    method: "POST",
    url: "/v1/public/chat",
    headers: { origin: PUBLIC },
    payload: { publicKey, visitorId: `visitor-${crypto.randomUUID().slice(0, 8)}`, message },
  });
const open = async () => (await call("GET", `${base()}/gaps`)).json();
/** The assistant's reply as the visitor reads it, from the chat's event stream. */
const replyText = (body: string) =>
  body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as { type: string; text?: string })
    .filter((event) => event.type === "text")
    .map((event) => event.text)
    .join("");

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    CHAT_RATE_LIMIT_PER_MIN: "1000",
    PUBLIC_URL: PUBLIC,
    ADMIN_ORIGIN: "http://admin.test.local",
  } as NodeJS.ProcessEnv);
  app = await buildApp({ db: appDb.db, config, gateway: createGatewayFromEnv({}).gateway });

  cookie = await signup("gaps-owner");
  tenantId = await createTenant(cookie, "Maple Bakery");
  const created = await call("POST", `/v1/tenants/${tenantId}/bots`, {
    name: "Maple Bakery Assistant",
    pack: "cafe-bakery",
  });
  botId = created.json().bot.id;
  publicKey = created.json().keys[0].publicKey;
  await call("PATCH", base(), { status: "active" });
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("questions the assistant couldn't answer", () => {
  const question = "Do you deliver to Kakabeka Falls?";

  it("lists a question the assistant had no answer for, without showing visitors the marker", async () => {
    expect(await open()).toEqual({ gaps: [], openCount: 0 });

    const reply = await ask(question);
    expect(reply.statusCode).toBe(200);
    expect(replyText(reply.body)).toContain("couldn't find that");
    expect(reply.body).not.toContain("[[gap");

    await ask(question);
    const list = await open();
    expect(list.openCount).toBe(1);
    expect(list.gaps).toMatchObject([{ topic: question, question, status: "open", occurrences: 2 }]);
  });

  it("turns the business's answer into a Q&A answer the assistant uses from then on", async () => {
    const [gap] = (await open()).gaps;
    const answer = "Yes, we deliver to Kakabeka Falls every Friday.";
    expect((await call("POST", `${base()}/gaps/${gap.id}/answer`, { question, answer: "" })).statusCode).toBe(
      400,
    );
    const res = await call("POST", `${base()}/gaps/${gap.id}/answer`, { question, answer });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ gap: { status: "answered" }, pair: { question, answer } });
    expect(res.json().gap.qaPairId).toBe(res.json().pair.id);

    expect(await open()).toEqual({ gaps: [], openCount: 0 });
    expect((await call("GET", `${base()}/gaps?status=answered`)).json().gaps).toHaveLength(1);
    expect((await call("GET", `${base()}/qa`)).json().pairs).toMatchObject([{ question, answer }]);

    // The next visitor gets the answer, and nothing new lands on the list.
    const reply = await ask(question);
    expect(replyText(reply.body)).toContain("every Friday");
    expect((await open()).openCount).toBe(0);
  });

  it("dismisses a question, and puts it back", async () => {
    await ask("Is the moon made of cheese?");
    const [gap] = (await open()).gaps;
    expect((await call("PATCH", `${base()}/gaps/${gap.id}`, { status: "answered" })).statusCode).toBe(400);
    expect((await call("PATCH", `${base()}/gaps/${gap.id}`, { status: "dismissed" })).json().gap.status).toBe(
      "dismissed",
    );
    expect(await open()).toEqual({ gaps: [], openCount: 0 });
    // Asked again, it stays off the list.
    await ask("Is the moon made of cheese?");
    expect((await open()).openCount).toBe(0);
    expect((await call("GET", `${base()}/gaps?status=dismissed`)).json().gaps).toMatchObject([
      { occurrences: 2 },
    ]);

    expect((await call("PATCH", `${base()}/gaps/${gap.id}`, { status: "open" })).statusCode).toBe(200);
    expect((await open()).openCount).toBe(1);
  });

  it("keeps other businesses out", async () => {
    const [gap] = (await open()).gaps;
    const stranger = { cookie: await signup("gaps-stranger") };
    await createTenant(stranger.cookie, "Stranger Co");
    expect([403, 404]).toContain((await call("GET", `${base()}/gaps`, undefined, stranger)).statusCode);
    expect([403, 404]).toContain(
      (await call("PATCH", `${base()}/gaps/${gap.id}`, { status: "dismissed" }, stranger)).statusCode,
    );
    expect([403, 404]).toContain(
      (await call("POST", `${base()}/gaps/${gap.id}/answer`, { question: "Moon?", answer: "No." }, stranger))
        .statusCode,
    );
    expect((await open()).openCount).toBe(1);
    expect((await call("GET", `${base()}/gaps?status=nope`)).statusCode).toBe(400);
    expect(
      (await call("PATCH", `${base()}/gaps/${crypto.randomUUID()}`, { status: "open" })).statusCode,
    ).toBe(404);
  });
});
