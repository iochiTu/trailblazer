import {
  auditLogs,
  bots,
  businessProfiles,
  catalogItems,
  createDb,
  type DbHandle,
  knowledgeSources,
  onboardings,
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
import { dueAfterOneWorkingDay } from "./lib/onboarding.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const PUBLIC = "http://chat.test.local";

describe("the page is due one working day after the materials arrived", () => {
  const due = (iso: string) => dueAfterOneWorkingDay(new Date(iso)).toISOString();

  it("same time the next weekday", () => {
    // Tuesday 14:30 in Toronto (EST, UTC-5) → Wednesday 14:30.
    expect(due("2026-11-10T19:30:00Z")).toBe("2026-11-11T19:30:00.000Z");
  });

  it("Friday → Monday", () => {
    expect(due("2026-11-13T16:00:00Z")).toBe("2026-11-16T16:00:00.000Z");
  });

  it("over the weekend the clock starts on Monday at 9:00", () => {
    // Saturday afternoon and Sunday night → Tuesday 9:00.
    expect(due("2026-11-14T18:00:00Z")).toBe("2026-11-17T14:00:00.000Z");
    expect(due("2026-11-16T03:00:00Z")).toBe("2026-11-17T14:00:00.000Z");
  });

  it("goes by Toronto's calendar, not UTC's", () => {
    // Friday 21:00 in Toronto is already Saturday in UTC: still due Monday 21:00.
    expect(due("2026-11-14T02:00:00Z")).toBe("2026-11-17T02:00:00.000Z");
  });

  it("keeps the wall-clock time across a daylight saving change", () => {
    // Friday 10:00 EDT (UTC-4) before the change on Sunday 1 November → Monday 10:00 EST (UTC-5).
    expect(due("2026-10-30T14:00:00Z")).toBe("2026-11-02T15:00:00.000Z");
    // Friday 10:00 EST before the change on Sunday 8 March → Monday 10:00 EDT.
    expect(due("2026-03-06T15:00:00Z")).toBe("2026-03-09T14:00:00.000Z");
  });
});

let appDb: DbHandle;
let ownerDb: DbHandle;
let app: FastifyInstance;
let operatorCookie: string;
const emails: string[] = [];
const tenantIds: string[] = [];

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

const op = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
  cookie = operatorCookie,
) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

/** A business signed up by its owner, with one assistant (not active yet). */
async function business(name: string) {
  const owner = await signup("owner");
  const tenantId = (
    await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: { cookie: owner.cookie },
      payload: { name },
    })
  ).json().tenant.id as string;
  tenantIds.push(tenantId);
  const created = await app.inject({
    method: "POST",
    url: `/v1/tenants/${tenantId}/bots`,
    headers: { cookie: owner.cookie },
    payload: { name: `${name} Assistant`, pack: "trades" },
  });
  expect(created.statusCode, created.body).toBe(201);
  return { owner, tenantId, botId: created.json().bot.id as string };
}

interface Checklist {
  id: string;
  tenantId: string;
  botId: string;
  dueAt: string;
  liveAt: string | null;
  note: string | null;
  createdBy: string | null;
  pageUrl: string | null;
  finished: boolean;
  facts: { missing: string[]; services: number; sources: { ready: number } };
  steps: { id: string; manual: boolean; state: string; mark: { by: string } | null }[];
}

const stateOf = (checklist: Checklist) => Object.fromEntries(checklist.steps.map((s) => [s.id, s.state]));

const listed = async (id: string) =>
  ((await op("GET", "/v1/operator/onboardings")).json().onboardings as Checklist[]).find((o) => o.id === id);

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  app = await buildApp({
    db: appDb.db,
    config: loadConfig({
      NODE_ENV: "test",
      AUTH_RATE_LIMIT_PER_MIN: "1000",
      CHAT_RATE_LIMIT_PER_MIN: "1000",
      PUBLIC_URL: PUBLIC,
      PLATFORM_CACHE_SECONDS: "0",
    } as NodeJS.ProcessEnv),
    gateway: createGatewayFromEnv({}).gateway,
  });
  const operator = await signup("operator");
  operatorCookie = operator.cookie;
  await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, operator.id));
});

afterAll(async () => {
  if (ownerDb) {
    if (tenantIds.length) await ownerDb.db.delete(tenants).where(inArray(tenants.id, tenantIds));
    await ownerDb.db.delete(operatorAuditLogs).where(eq(operatorAuditLogs.targetType, "onboarding"));
    if (emails.length) await ownerDb.db.delete(users).where(inArray(users.email, emails));
  }
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("onboarding checklist", () => {
  let shop: Awaited<ReturnType<typeof business>>;
  let checklist: Checklist;

  it("is for staff only", async () => {
    const visitor = await signup("visitor");
    expect((await op("GET", "/v1/operator/onboardings", undefined, visitor.cookie)).statusCode).toBe(404);
    expect(
      (await op("POST", "/v1/operator/onboardings", { tenantId: crypto.randomUUID() }, visitor.cookie))
        .statusCode,
    ).toBe(404);
  });

  it("starts for a business, due one working day after the materials arrived", async () => {
    shop = await business("Rideau Plumbing");
    const receivedAt = "2026-11-13T16:00:00Z"; // a Friday
    const res = await op("POST", "/v1/operator/onboardings", {
      tenantId: shop.tenantId,
      receivedAt,
      note: "Sent their price list by email",
    });
    expect(res.statusCode, res.body).toBe(201);
    checklist = res.json().onboarding;
    expect(checklist).toMatchObject({
      tenantId: shop.tenantId,
      botId: shop.botId,
      dueAt: "2026-11-16T16:00:00.000Z",
      liveAt: null,
      note: "Sent their price list by email",
      finished: false,
    });
    expect(checklist.createdBy).toMatch(/^operator-/);
    expect(checklist.pageUrl).toMatch(new RegExp(`^${PUBLIC}/`));
    expect(stateOf(checklist)).toEqual({
      sources: "open",
      page: "open",
      services: "open",
      photos: "open",
      review: "open",
      google: "open",
      live: "open",
    });
    expect(checklist.facts.missing).toEqual(["description", "contact", "hours"]);
    expect(checklist.steps.filter((s) => s.manual).map((s) => s.id)).toEqual(["review", "google"]);

    const [log] = await ownerDb.db
      .select()
      .from(operatorAuditLogs)
      .where(
        and(eq(operatorAuditLogs.targetId, checklist.id), eq(operatorAuditLogs.action, "onboarding.started")),
      );
    expect(log).toBeDefined();
  });

  it("one checklist per business, and only for a business with an assistant", async () => {
    const again = await op("POST", "/v1/operator/onboardings", { tenantId: shop.tenantId });
    expect(again.statusCode).toBe(409);

    const empty = await signup("empty");
    const tenantId = (
      await app.inject({
        method: "POST",
        url: "/v1/tenants",
        headers: { cookie: empty.cookie },
        payload: { name: "No Assistant Yet" },
      })
    ).json().tenant.id as string;
    tenantIds.push(tenantId);
    const none = await op("POST", "/v1/operator/onboardings", { tenantId });
    expect(none.statusCode).toBe(400);
    expect(none.json().message).toMatch(/no assistant/);

    // An assistant of another business.
    const other = await op("POST", "/v1/operator/onboardings", { tenantId, botId: shop.botId });
    expect(other.statusCode).toBe(400);

    expect((await op("POST", "/v1/operator/onboardings", { tenantId: crypto.randomUUID() })).statusCode).toBe(
      404,
    );
  });

  it("not for a prospect demo", async () => {
    const demo = await business("Prospect Shop");
    await ownerDb.db.update(tenants).set({ kind: "demo" }).where(eq(tenants.id, demo.tenantId));
    const res = await op("POST", "/v1/operator/onboardings", { tenantId: demo.tenantId });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/demo/);
  });

  it("ticks the steps the business's information shows", async () => {
    await ownerDb.db.insert(knowledgeSources).values({
      tenantId: shop.tenantId,
      botId: shop.botId,
      type: "text",
      title: "Price list",
      status: "ready",
    });
    await ownerDb.db
      .insert(businessProfiles)
      .values({
        tenantId: shop.tenantId,
        botId: shop.botId,
        description: "Plumbing repairs and water heaters in Ottawa.",
        phone: "613-555-0199",
        hours: { mon: [{ open: "08:00", close: "17:00" }] },
      })
      .onConflictDoUpdate({
        target: businessProfiles.botId,
        set: {
          description: "Plumbing repairs and water heaters in Ottawa.",
          phone: "613-555-0199",
          hours: { mon: [{ open: "08:00", close: "17:00" }] },
        },
      });
    await ownerDb.db
      .insert(catalogItems)
      .values({ tenantId: shop.tenantId, botId: shop.botId, name: "Water heater install" });

    const now = (await listed(checklist.id))!;
    expect(stateOf(now)).toMatchObject({ sources: "done", page: "done", services: "done", photos: "open" });
    expect(now.facts.services).toBe(1);
  });

  it("staff tick the owner's review and the Google link, or mark a step not needed", async () => {
    // Automatic steps can't be ticked by hand.
    const forced = await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, {
      step: { id: "photos", state: "done" },
    });
    expect(forced.statusCode).toBe(400);

    const skipped = await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, {
      step: { id: "photos", state: "skipped" },
    });
    expect(skipped.statusCode, skipped.body).toBe(200);
    const photos = (skipped.json().onboarding as Checklist).steps.find((s) => s.id === "photos")!;
    expect(photos.state).toBe("skipped");
    expect(photos.mark?.by).toMatch(/^operator-/);

    const google = await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, {
      step: { id: "google", state: "done" },
    });
    expect(stateOf(google.json().onboarding).google).toBe("done");

    // Undo puts it back on the list.
    const undone = await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, {
      step: { id: "google", state: "open" },
    });
    expect(stateOf(undone.json().onboarding).google).toBe("open");

    // Going live is never ticked by hand, and there must be something to change.
    expect(
      (
        await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, {
          step: { id: "live", state: "skipped" },
        })
      ).statusCode,
    ).toBe(400);
    expect((await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, {})).statusCode).toBe(400);
  });

  it("moving when the materials arrived moves the deadline", async () => {
    const res = await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, {
      receivedAt: "2026-11-10T19:30:00Z",
      note: null,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().onboarding).toMatchObject({ dueAt: "2026-11-11T19:30:00.000Z", note: null });
  });

  it("publishes the page once the owner reviewed it", async () => {
    const early = await op("POST", `/v1/operator/onboardings/${checklist.id}/go-live`);
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("owner_review_missing");

    await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, { step: { id: "review", state: "done" } });
    const res = await op("POST", `/v1/operator/onboardings/${checklist.id}/go-live`);
    expect(res.statusCode, res.body).toBe(200);
    const live = res.json().onboarding as Checklist;
    expect(stateOf(live).live).toBe("done");
    expect(live.liveAt).not.toBeNull();

    const [bot] = await ownerDb.db.select().from(bots).where(eq(bots.id, shop.botId));
    expect(bot).toMatchObject({ status: "active", hostedPageEnabled: true });
    // In the business's own activity log, too.
    const entries = await ownerDb.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, shop.tenantId), eq(auditLogs.targetId, shop.botId)));
    expect(entries.some((e) => (e.metadata as { via?: string }).via === "onboarding")).toBe(true);

    // Only Google left.
    expect(live.finished).toBe(false);
    const done = await op("PATCH", `/v1/operator/onboardings/${checklist.id}`, {
      step: { id: "google", state: "done" },
    });
    expect(done.json().onboarding.finished).toBe(true);
  });

  it("notices when the owner publishes the page themselves", async () => {
    const other = await business("Glebe Electric");
    const started = (await op("POST", "/v1/operator/onboardings", { tenantId: other.tenantId })).json()
      .onboarding as Checklist;
    expect(started.liveAt).toBeNull();
    await app.inject({
      method: "PATCH",
      url: `/v1/tenants/${other.tenantId}/bots/${other.botId}`,
      headers: { cookie: other.owner.cookie },
      payload: { status: "active" },
    });
    // Active, but the page is still off: not live yet.
    expect(stateOf((await listed(started.id))!).live).toBe("open");
    await app.inject({
      method: "PATCH",
      url: `/v1/tenants/${other.tenantId}/bots/${other.botId}`,
      headers: { cookie: other.owner.cookie },
      payload: { hostedPageEnabled: true },
    });
    const seen = (await listed(started.id))!;
    expect(stateOf(seen).live).toBe("done");
    expect(seen.liveAt).not.toBeNull();
    const [row] = await ownerDb.db.select().from(onboardings).where(eq(onboardings.id, started.id));
    expect(row!.liveAt).not.toBeNull();
  });

  it("removing the checklist leaves the business alone", async () => {
    const res = await op("DELETE", `/v1/operator/onboardings/${checklist.id}`);
    expect(res.statusCode).toBe(204);
    expect(await listed(checklist.id)).toBeUndefined();
    const [tenant] = await ownerDb.db.select().from(tenants).where(eq(tenants.id, shop.tenantId));
    expect(tenant).toBeDefined();
    expect((await op("DELETE", `/v1/operator/onboardings/${checklist.id}`)).statusCode).toBe(404);
    expect((await op("DELETE", "/v1/operator/onboardings/not-an-id")).statusCode).toBe(404);
  });
});
