import { runSetup, syncSource } from "@traiblazer/core";
import { createDb, type DbHandle, documents, runMigrations, tenants, users } from "@traiblazer/db";
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
// No keys: the offline provider, so the setup assistant only looks up contact details.
const { gateway } = createGatewayFromEnv({});

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
const call = (
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
  headers = { cookie },
) => app.inject({ method, url, headers, payload: payload as object | undefined });
const interview = async () => (await call("GET", `${base()}/interview`)).json();
const sources = async () => (await call("GET", `${base()}/sources`)).json().sources;

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

  cookie = await signup("interview-owner");
  tenantId = await createTenant(cookie, "Northside Plumbing");
  const created = await call("POST", `/v1/tenants/${tenantId}/bots`, {
    name: "Northside Plumbing Assistant",
    pack: "trades",
  });
  botId = created.json().bot.id;
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("setup interview", () => {
  let sourceId: string;

  it("asks the questions for the business's industry", async () => {
    const data = await interview();
    expect(data).toMatchObject({ answers: {}, sourceId: null, updatedAt: null });
    const keys = data.questions.map((question: { key: string }) => question.key);
    expect(keys).toEqual(expect.arrayContaining(["about", "services", "emergency", "quotes"]));
    expect(data.questions[1]).toMatchObject({
      key: "services",
      long: true,
      question: { en: expect.any(String), fr: expect.any(String) },
    });
  });

  it("saves the answers as one knowledge source, questions kept with their answers", async () => {
    // Questions this industry doesn't ask are refused.
    const unknown = await call("PUT", `${base()}/interview`, { answers: { favouriteColour: "Blue" } });
    expect(unknown.statusCode).toBe(400);

    const saved = await call("PUT", `${base()}/interview`, {
      answers: {
        services: "Drain cleaning – from $149\r\n\r\n  Water heater installation – call for a quote  ",
        contact: "Call 705-555-0177 or write to office@northsideplumbing.example",
        emergency: "  ",
        hours: "Monday to Friday 8 am to 5 pm",
      },
    });
    expect(saved.statusCode).toBe(200);
    sourceId = saved.json().sourceId;
    // Answers are tidied and empty ones dropped.
    expect(saved.json().answers).toEqual({
      services: "Drain cleaning – from $149\nWater heater installation – call for a quote",
      contact: "Call 705-555-0177 or write to office@northsideplumbing.example",
      hours: "Monday to Friday 8 am to 5 pm",
    });

    expect(await sources()).toMatchObject([
      { id: sourceId, type: "text", title: "Interview answers", interview: true, status: "pending" },
    ]);
    const { source } = (await call("GET", `${base()}/sources/${sourceId}`)).json();
    // In the questions' order, each question with its answer.
    expect(source.content).toBe(
      [
        "What services or products do you offer, and at what price?\nDrain cleaning – from $149\nWater heater installation – call for a quote",
        "When are you open?\nMonday to Friday 8 am to 5 pm",
        "How should customers reach you or book?\nCall 705-555-0177 or write to office@northsideplumbing.example",
      ].join("\n\n"),
    );

    // Indexed like pasted text: one document the assistant answers from.
    await syncSource({ db: appDb.db }, tenantId, sourceId);
    const docs = await ownerDb.db.select().from(documents).where(eq(documents.sourceId, sourceId));
    expect(docs).toHaveLength(1);
    expect(docs[0]!.content).toContain("Drain cleaning – from $149");
  });

  it("is enough for the setup assistant to start from", async () => {
    expect((await call("GET", `${base()}/setup`)).json()).toMatchObject({ pages: 1 });
    const started = await call("POST", `${base()}/setup`);
    expect(started.statusCode).toBe(201);
    await runSetup({ db: appDb.db, gateway }, tenantId, started.json().run.id);
    expect((await call("GET", `${base()}/setup`)).json().run.suggestion.profile).toMatchObject({
      phone: "705-555-0177",
      email: "office@northsideplumbing.example",
    });
  });

  it("updates the same source, which can't be edited as pasted text", async () => {
    const again = await call("PUT", `${base()}/interview`, {
      answers: { about: "Family-run plumbing company in Sudbury." },
    });
    expect(again.json().sourceId).toBe(sourceId);
    expect(await interview()).toMatchObject({
      sourceId,
      answers: { about: "Family-run plumbing company in Sudbury." },
    });
    expect(await sources()).toHaveLength(1);

    const edit = await call("PATCH", `${base()}/sources/${sourceId}`, { content: "Something else" });
    expect(edit.statusCode).toBe(400);
    expect(edit.json().message).toMatch(/interview/);
  });

  it("removes the source when every answer is cleared", async () => {
    const cleared = await call("PUT", `${base()}/interview`, { answers: { about: "" } });
    expect(cleared.json()).toEqual({ sourceId: null, answers: {} });
    expect(await sources()).toEqual([]);
    expect(await interview()).toMatchObject({ answers: {}, sourceId: null });
  });

  it("needs the editor role to save, and keeps other businesses out", async () => {
    const stranger = await signup("interview-stranger");
    await createTenant(stranger, "Other Plumbing");
    const headers = { cookie: stranger };
    expect([403, 404]).toContain((await call("GET", `${base()}/interview`, undefined, headers)).statusCode);
    expect([403, 404]).toContain(
      (await call("PUT", `${base()}/interview`, { answers: { about: "Hi" } }, headers)).statusCode,
    );
  });
});
