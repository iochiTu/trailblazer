import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDemo, JOB_TYPES, syncSource } from "@traiblazer/core";
import {
  businessProfiles,
  catalogItems,
  createDb,
  type DbHandle,
  demos,
  jobs,
  knowledgeSources,
  memberships,
  operatorAuditLogs,
  runMigrations,
  setupRuns,
  tenants,
  users,
} from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  createGatewayFromEnv,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
} from "@traiblazer/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const PUBLIC = "http://chat.test.local";
// Mirrors the shape of the built apps/chat/dist/index.html.
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex" />
    <title>Chat</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

/** What the prospect publishes about itself (as pasted from its Google listing). */
const LISTING = `Harbour Heating & Cooling
Furnace repair, AC installation and maintenance plans for homes in Kingston and Gananoque.
Call 613-555-0142 or write to office@harbourheating.example.
Furnace tune-up from $129. Air conditioner installation, call for a quote.`;

/** What a careful model proposes from that text. */
const SUGGESTION = {
  businessName: "Harbour Heating & Cooling",
  phone: "613-555-0142",
  email: "office@harbourheating.example",
  description: "Furnace repair, AC installation and maintenance plans for homes in Kingston and Gananoque.",
  services: [
    { name: "Furnace tune-up", price: "from $129", kind: "service" },
    { name: "Air conditioner installation", kind: "service" },
    // Not in the text: dropped by the setup assistant's own check.
    { name: "Duct cleaning", price: "$299", kind: "service" },
  ],
  greeting: { en: "Welcome to Harbour Heating & Cooling! How can I help?" },
  quickReplies: { en: ["How much is a furnace tune-up?"] },
  missing: [],
};

/** A model that replies with the same text every time (the setup assistant's JSON). */
class Scripted implements LLMProvider {
  readonly id = "scripted";
  constructor(private readonly reply: string) {}
  supportsImages() {
    return false;
  }
  async *stream(model: string, _request: ChatRequest): AsyncIterable<ChatEvent> {
    yield { type: "text", text: this.reply };
    yield {
      type: "done",
      model,
      stopReason: "end",
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}
const gatewayWith = (reply: string) =>
  new LLMGateway({
    providers: [new OfflineProvider(), new Scripted(reply)],
    routes: {
      chat: [{ provider: "offline", model: "knowledge" }],
      aux: [{ provider: "offline", model: "echo" }],
      agent: [{ provider: "scripted", model: "s1" }],
    },
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

interface Demo {
  id: string;
  tenantId: string;
  botId: string;
  name: string;
  status: string;
  pageUrl: string;
}

/** Builds a demo from the listing text and returns it. */
async function createDemo(overrides: object = {}): Promise<Demo> {
  const res = await op("POST", "/v1/operator/demos", {
    businessName: "Harbour Heating & Cooling",
    pack: "trades",
    variant: "hvac",
    text: LISTING,
    note: "Met Dana at the home show",
    ...overrides,
  });
  expect(res.statusCode, res.body).toBe(201);
  const demo = res.json().demo as Demo;
  tenantIds.push(demo.tenantId);
  return demo;
}

/** Does what the worker does for a demo: reads its sources, then fills the page in. */
async function runWorker(demo: Demo, gateway = gatewayWith(JSON.stringify(SUGGESTION))) {
  const sources = await ownerDb.db
    .select({ id: knowledgeSources.id })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.botId, demo.botId));
  for (const source of sources)
    await syncSource({ db: appDb.db, embeddings: null, gateway }, demo.tenantId, source.id);
  return buildDemo({ db: appDb.db, gateway }, demo.tenantId, { demoId: demo.id });
}

const listed = async (id: string) =>
  ((await op("GET", "/v1/operator/demos")).json().demos as (Demo & Record<string, unknown>)[]).find(
    (d) => d.id === id,
  );

const visit = (url: string) => app.inject({ method: "GET", url, headers: { "sec-fetch-dest": "document" } });
const pagePath = (demo: Demo) => demo.pageUrl.replace(PUBLIC, "");

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const dist = await mkdtemp(path.join(tmpdir(), "tb-demo-"));
  await mkdir(path.join(dist, "assets"));
  await writeFile(path.join(dist, "index.html"), TEMPLATE);
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
    chatDistDir: dist,
  });
  const operator = await signup("operator");
  operatorCookie = operator.cookie;
  await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, operator.id));
});

afterAll(async () => {
  if (ownerDb) {
    if (tenantIds.length) await ownerDb.db.delete(tenants).where(inArray(tenants.id, tenantIds));
    await ownerDb.db.delete(operatorAuditLogs).where(eq(operatorAuditLogs.targetType, "demo"));
    if (emails.length) await ownerDb.db.delete(users).where(inArray(users.email, emails));
  }
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("prospect demos: building", () => {
  let demo: Demo;

  it("is for staff only", async () => {
    const visitor = await signup("visitor");
    expect((await op("GET", "/v1/operator/demos", undefined, visitor.cookie)).statusCode).toBe(404);
    expect(
      (
        await op(
          "POST",
          "/v1/operator/demos",
          { businessName: "x", pack: "trades", text: "y" },
          visitor.cookie,
        )
      ).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/operator/demos" })).statusCode).toBe(401);
  });

  it("needs something to read, a released industry and a public website", async () => {
    const post = (body: object) => op("POST", "/v1/operator/demos", body);
    expect((await post({ businessName: "No sources", pack: "trades" })).statusCode).toBe(400);
    expect((await post({ businessName: "Clinic", pack: "clinic", text: "x" })).statusCode).toBe(400);
    expect(
      (await post({ businessName: "Local", pack: "trades", websiteUrl: "http://localhost:3000" })).statusCode,
    ).toBe(400);
  });

  it("creates a demo business with no members, its assistant, its sources and the jobs to build it", async () => {
    demo = await createDemo();
    expect(demo.status).toBe("building");
    expect(demo.pageUrl).toMatch(/\/c\/pk_test_/);

    const [tenant] = await ownerDb.db.select().from(tenants).where(eq(tenants.id, demo.tenantId));
    expect(tenant).toMatchObject({ kind: "demo", name: "Harbour Heating & Cooling", status: "active" });
    expect(
      await ownerDb.db.select().from(memberships).where(eq(memberships.tenantId, demo.tenantId)),
    ).toEqual([]);
    const queued = await ownerDb.db.select().from(jobs).where(eq(jobs.tenantId, demo.tenantId));
    expect(queued.map((j) => j.type).sort()).toEqual([JOB_TYPES.demoBuild, JOB_TYPES.sourceSync]);
    expect((await listed(demo.id))?.note).toBe("Met Dana at the home show");
  });

  it("waits for its sources, then fills the page in from what they say", async () => {
    // The sources haven't been read yet.
    expect(
      await buildDemo({ db: appDb.db, gateway: gatewayWith("{}") }, demo.tenantId, { demoId: demo.id }),
    ).toBe("waiting");
    expect(await runWorker(demo)).toBe("ready");

    const [profile] = await ownerDb.db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.botId, demo.botId));
    expect(profile).toMatchObject({
      businessName: "Harbour Heating & Cooling",
      phone: "613-555-0142",
      email: "office@harbourheating.example",
      description: SUGGESTION.description,
    });
    const services = await ownerDb.db
      .select({ name: catalogItems.name, priceText: catalogItems.priceText })
      .from(catalogItems)
      .where(eq(catalogItems.botId, demo.botId))
      .orderBy(catalogItems.position);
    // Only what the text supports: "Duct cleaning" and its price were made up.
    expect(services).toEqual([
      { name: "Furnace tune-up", priceText: "from $129" },
      { name: "Air conditioner installation", priceText: null },
    ]);
    const [run] = await ownerDb.db.select().from(setupRuns).where(eq(setupRuns.botId, demo.botId));
    expect(run?.status).toBe("applied");
    expect(await listed(demo.id)).toMatchObject({ status: "ready", error: null, services: 2 });
  });

  it("shows the demo page with a notice, never listed, even when the assistant is active", async () => {
    // Opened while still a draft: counted, so operators see whether the prospect looked at it.
    const agent = { "sec-fetch-dest": "document", "user-agent": "Mozilla/5.0 (test browser)" };
    await app.inject({ method: "GET", url: pagePath(demo), headers: agent });
    expect((await listed(demo.id))?.views).toBe(1);

    await op("PATCH", `/v1/tenants/${demo.tenantId}/bots/${demo.botId}`, { status: "active" });
    const page = await visit(pagePath(demo));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Demo page prepared for Harbour Heating &amp; Cooling by Traiblazer");
    expect(page.body).toContain('<meta name="robots" content="noindex">');
    expect(page.body).toContain("Furnace tune-up");
    expect(page.body).toContain("from $129");
    expect(page.body).toContain("613-555-0142");
  });

  it("stays private: no friendly link while it is a demo", async () => {
    const res = await op("PATCH", `/v1/tenants/${demo.tenantId}/bots/${demo.botId}`, {
      pageSlug: `harbour-heating-${crypto.randomUUID().slice(0, 6)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("friendly link");
  });

  it("counts page views and keeps demos out of the businesses list and counts", async () => {
    expect((await listed(demo.id))?.views).toBeGreaterThanOrEqual(1);
    const businesses = (await op("GET", "/v1/operator/tenants")).json().tenants as { id: string }[];
    expect(businesses.some((t) => t.id === demo.tenantId)).toBe(false);
    const overview = (await op("GET", "/v1/operator/overview")).json();
    expect(overview.demos).toBeGreaterThanOrEqual(1);
  });

  it("builds again without repeating what is already on the page", async () => {
    const again = await op("POST", `/v1/operator/demos/${demo.id}/build`);
    expect(again.json().demo.status).toBe("building");
    expect((await op("POST", `/v1/operator/demos/${demo.id}/build`)).statusCode).toBe(409);
    expect(await runWorker(demo)).toBe("ready");
    const services = await ownerDb.db.select().from(catalogItems).where(eq(catalogItems.botId, demo.botId));
    expect(services).toHaveLength(2);
  });

  it("says so when nothing could be read or the setup assistant fails", async () => {
    // A website that couldn't be read leaves nothing to build from.
    const empty = await createDemo({ businessName: "Empty Plumbing", variant: "plumbing" });
    await ownerDb.db
      .update(knowledgeSources)
      .set({ status: "failed", error: "unreachable" })
      .where(eq(knowledgeSources.botId, empty.botId));
    expect(
      await buildDemo({ db: appDb.db, gateway: gatewayWith("{}") }, empty.tenantId, { demoId: empty.id }),
    ).toBe("needs_information");
    expect(await listed(empty.id)).toMatchObject({ status: "needs_information", error: "no_information" });

    const failing = await createDemo({ businessName: "Unlucky Roofing", variant: "roofing" });
    expect(await runWorker(failing, gatewayWith("I can't do that."))).toBe("failed");
    expect(await listed(failing.id)).toMatchObject({
      status: "failed",
      error: "unreadable_reply",
      services: 0,
    });
    // The page still opens, with the name and the chat.
    expect((await visit(pagePath(failing))).body).toContain("Unlucky Roofing");
  });
});

describe("prospect demos: hand-over and removal", () => {
  let demo: Demo;

  beforeAll(async () => {
    demo = await createDemo({ businessName: "Kingston Tire & Auto", pack: "auto-repair", variant: "tires" });
    await runWorker(demo);
  });

  it("hands the business over to an existing account, which then owns it", async () => {
    const handOver = (email: string) => op("POST", `/v1/operator/demos/${demo.id}/hand-over`, { email });
    const missing = await handOver("nobody@test.local");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("account_not_found");
    const staff = await signup("staff");
    await ownerDb.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, staff.id));
    expect((await handOver(staff.email)).statusCode).toBe(400);

    const owner = await signup("owner");
    const res = await handOver(owner.email.toUpperCase());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().demo).toMatchObject({ status: "handed_over", handedOverTo: owner.email });

    const [tenant] = await ownerDb.db.select().from(tenants).where(eq(tenants.id, demo.tenantId));
    expect(tenant?.kind).toBe("business");
    const mine = await app.inject({ method: "GET", url: "/v1/tenants", headers: { cookie: owner.cookie } });
    expect(mine.json().tenants).toMatchObject([{ id: demo.tenantId, role: "owner" }]);
    // The owner can open their assistant; the page loses the demo notice.
    const bot = await app.inject({
      method: "GET",
      url: `/v1/tenants/${demo.tenantId}/bots/${demo.botId}`,
      headers: { cookie: owner.cookie },
    });
    expect(bot.statusCode).toBe(200);
    expect((await visit(pagePath(demo))).body).not.toContain("Demo page prepared for");
    // Now a business: listed with the others, and no longer a demo to rebuild, hand over or delete.
    const businesses = (await op("GET", "/v1/operator/tenants")).json().tenants as { id: string }[];
    expect(businesses.some((t) => t.id === demo.tenantId)).toBe(true);
    expect((await handOver(owner.email)).statusCode).toBe(409);
    expect((await op("POST", `/v1/operator/demos/${demo.id}/build`)).statusCode).toBe(409);
    expect((await op("DELETE", `/v1/operator/demos/${demo.id}`)).statusCode).toBe(409);
    expect(await ownerDb.db.select().from(tenants).where(eq(tenants.id, demo.tenantId))).toHaveLength(1);
  });

  it("never fills in a page that was handed over while its build was queued", async () => {
    await ownerDb.db.update(demos).set({ status: "building" }).where(eq(demos.id, demo.id));
    expect(
      await buildDemo({ db: appDb.db, gateway: gatewayWith(JSON.stringify(SUGGESTION)) }, demo.tenantId, {
        demoId: demo.id,
      }),
    ).toBe("skipped");
    await ownerDb.db.update(demos).set({ status: "handed_over" }).where(eq(demos.id, demo.id));
  });

  it("respects the limit on businesses per account", async () => {
    const busy = await signup("busy");
    const { maxBusinessesPerAccount } = (await op("GET", "/v1/operator/policies")).json().policies;
    for (let i = 0; i < maxBusinessesPerAccount; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/tenants",
        headers: { cookie: busy.cookie },
        payload: { name: `Busy ${i}` },
      });
      tenantIds.push(res.json().tenant.id);
    }
    const extra = await createDemo({ businessName: "One Too Many Plumbing" });
    await runWorker(extra);
    const res = await op("POST", `/v1/operator/demos/${extra.id}/hand-over`, { email: busy.email });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("business_limit_reached");
  });

  it("deletes a demo with everything in it, and records what operators did", async () => {
    const gone = await createDemo({ businessName: "Short Lived Electric", variant: "electrical" });
    await runWorker(gone);
    expect((await op("DELETE", `/v1/operator/demos/${gone.id}`)).statusCode).toBe(204);
    expect(await ownerDb.db.select().from(tenants).where(eq(tenants.id, gone.tenantId))).toEqual([]);
    expect(await ownerDb.db.select().from(demos).where(eq(demos.id, gone.id))).toEqual([]);
    expect(await ownerDb.db.select().from(catalogItems).where(eq(catalogItems.botId, gone.botId))).toEqual(
      [],
    );
    expect((await visit(pagePath(gone))).statusCode).toBe(404);
    expect((await op("DELETE", `/v1/operator/demos/${gone.id}`)).statusCode).toBe(404);

    const actions = (
      await ownerDb.db
        .select({ action: operatorAuditLogs.action })
        .from(operatorAuditLogs)
        .where(and(eq(operatorAuditLogs.targetType, "demo"), eq(operatorAuditLogs.targetId, gone.id)))
    ).map((entry) => entry.action);
    expect(actions.sort()).toEqual(["demo.created", "demo.deleted"]);
  });
});
