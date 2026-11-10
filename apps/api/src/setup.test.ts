import { runSetup, syncSource } from "@traiblazer/core";
import { createDb, type DbHandle, jobs, runMigrations, setupRuns, tenants, users } from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { SETUP_RUNS_PER_DAY } from "./routes/setup.js";

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
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
  headers = { cookie },
) => app.inject({ method, url, headers, payload: payload as object | undefined });
const latest = async () => (await call("GET", `${base()}/setup`)).json();
/** What the worker does with a queued run. */
const work = (runId: string) => runSetup({ db: appDb.db, gateway }, tenantId, runId);

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

  cookie = await signup("setup-owner");
  tenantId = await createTenant(cookie, "Maple Bakery");
  const created = await call("POST", `/v1/tenants/${tenantId}/bots`, {
    name: "Maple Bakery Assistant",
    pack: "cafe-bakery",
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

describe("setup assistant", () => {
  let runId: string;

  it("needs something to read first", async () => {
    expect(await latest()).toEqual({ run: null, pages: 0 });
    const res = await call("POST", `${base()}/setup`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("setup_no_information");
  });

  it("queues a run and doesn't start a second one meanwhile", async () => {
    const source = await call("POST", `${base()}/sources`, {
      type: "text",
      title: "About us",
      content:
        "Maple Bakery bakes sourdough every morning.\n\nCall 807-555-0142 or write to hello@maplebakery.example.",
    });
    await syncSource({ db: appDb.db }, tenantId, source.json().source.id);

    const started = await call("POST", `${base()}/setup`);
    expect(started.statusCode).toBe(201);
    expect(started.json().run).toMatchObject({ status: "pending", suggestion: null, error: null });
    runId = started.json().run.id;
    expect(await latest()).toMatchObject({ run: { id: runId, status: "pending" }, pages: 1 });

    const queued = await ownerDb.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, "bot.setup")));
    expect(queued.map((job) => job.payload)).toEqual([{ runId }]);

    const again = await call("POST", `${base()}/setup`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("setup_running");
    // A run the worker may still be on can't be discarded either.
    expect((await call("DELETE", `${base()}/setup/${runId}`)).statusCode).toBe(409);
  });

  it("shows the suggestion once the worker has read the information", async () => {
    await work(runId);
    const { run } = await latest();
    expect(run).toMatchObject({
      id: runId,
      status: "ready",
      suggestion: {
        profile: { phone: "807-555-0142", email: "hello@maplebakery.example" },
        pagesRead: 1,
        basic: true,
      },
    });
  });

  it("saves what the owner kept, and only that", async () => {
    // Not ready, unknown or malformed: nothing to apply.
    expect((await call("POST", `${base()}/setup/${crypto.randomUUID()}/apply`, {})).statusCode).toBe(404);
    expect(
      (await call("POST", `${base()}/setup/${runId}/apply`, { profile: { email: "not an email" } }))
        .statusCode,
    ).toBe(400);

    const hours = { mon: [{ open: "07:00", close: "16:00" }], sun: [] };
    const applied = await call("POST", `${base()}/setup/${runId}/apply`, {
      profile: { phone: "807-555-0142", address: { full: "12 Water Street, Thunder Bay" }, hours },
      // German isn't one of this assistant's languages.
      greeting: { en: "Welcome to Maple Bakery!", de: "Willkommen!" },
      quickReplies: { fr: ["Quelles sont vos heures ?"] },
      answers: [{ question: "Do you have parking?", answer: "Yes, behind the building." }],
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().run).toMatchObject({ status: "applied", suggestion: null });

    const detail = (await call("GET", base())).json();
    expect(detail.profile).toMatchObject({
      businessName: "Maple Bakery",
      phone: "807-555-0142",
      // Left out of what was applied, so unchanged.
      email: null,
      address: { full: "12 Water Street, Thunder Bay" },
      hours,
    });
    expect(detail.bot.settings).toMatchObject({
      greeting: { en: "Welcome to Maple Bakery!" },
      quickReplies: { fr: ["Quelles sont vos heures ?"] },
    });
    expect(detail.bot.settings.greeting.de).toBeUndefined();
    const { pairs } = (await call("GET", `${base()}/qa`)).json();
    expect(pairs).toMatchObject([
      { question: "Do you have parking?", answer: "Yes, behind the building.", language: "en" },
    ]);

    // A suggestion is applied once.
    expect((await call("POST", `${base()}/setup/${runId}/apply`, {})).statusCode).toBe(404);
  });

  it("discards a suggestion and limits runs per day", async () => {
    const started = await call("POST", `${base()}/setup`);
    const second = started.json().run.id as string;
    await work(second);
    expect((await call("DELETE", `${base()}/setup/${second}`)).statusCode).toBe(204);
    expect((await latest()).run).toMatchObject({ id: runId, status: "applied" });

    // One run so far today (the discarded one doesn't count): fill the day up.
    const more = SETUP_RUNS_PER_DAY - 1;
    await ownerDb.db
      .insert(setupRuns)
      .values(Array.from({ length: more }, () => ({ tenantId, botId, status: "failed" as const })));
    const limited = await call("POST", `${base()}/setup`);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("setup_limit");
  });

  it("treats a run that never finished as failed, and lets the owner start again", async () => {
    await ownerDb.db.delete(setupRuns).where(eq(setupRuns.botId, botId));
    const [stuck] = await ownerDb.db
      .insert(setupRuns)
      .values({ tenantId, botId, status: "running", updatedAt: new Date(Date.now() - 30 * 60 * 1000) })
      .returning();
    expect((await latest()).run).toMatchObject({ id: stuck!.id, status: "failed", error: "timed_out" });
    expect((await call("POST", `${base()}/setup`)).statusCode).toBe(201);
  });

  it("keeps other businesses out", async () => {
    const stranger = await signup("setup-stranger");
    await createTenant(stranger, "Other Bakery");
    expect([403, 404]).toContain(
      (await call("GET", `${base()}/setup`, undefined, { cookie: stranger })).statusCode,
    );
    expect([403, 404]).toContain(
      (await call("POST", `${base()}/setup`, undefined, { cookie: stranger })).statusCode,
    );
    expect([403, 404]).toContain(
      (await call("POST", `${base()}/setup/${runId}/apply`, {}, { cookie: stranger })).statusCode,
    );
  });
});
