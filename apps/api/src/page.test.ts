import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assets, createDb, type DbHandle, runMigrations, tenants, users } from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PlatformConfig } from "./lib/platform.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const PUBLIC = "http://chat.test.local";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
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

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
const tenantIds: string[] = [];
const emails: string[] = [];
const slug = `smith-plumbing-${crypto.randomUUID().slice(0, 6)}`;

/** A signed-up owner with one business and one Trades/plumbing assistant. */
async function business(name: string) {
  const email = `owner-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const signup = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name: "Owner" },
  });
  const cookie = `tb_session=${signup.cookies.find((c) => c.name === "tb_session")!.value}`;
  const tenantId = (
    await app.inject({ method: "POST", url: "/v1/tenants", headers: { cookie }, payload: { name } })
  ).json().tenant.id as string;
  tenantIds.push(tenantId);
  const created = await app.inject({
    method: "POST",
    url: `/v1/tenants/${tenantId}/bots`,
    headers: { cookie },
    payload: { name: `${name} assistant`, pack: "trades", variant: "plumbing" },
  });
  const botId = created.json().bot.id as string;
  const base = `/v1/tenants/${tenantId}/bots/${botId}`;
  return { cookie, tenantId, botId, base, publicKey: created.json().keys[0].publicKey as string };
}

let owner: Awaited<ReturnType<typeof business>>;

const call = (
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  cookie = owner.cookie,
) =>
  app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const visit = (url: string) => app.inject({ method: "GET", url, headers: { "sec-fetch-dest": "document" } });

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  const dist = await mkdtemp(path.join(tmpdir(), "tb-page-"));
  await mkdir(path.join(dist, "assets"));
  await writeFile(path.join(dist, "index.html"), TEMPLATE);
  await writeFile(path.join(dist, "widget.js"), "/* widget */");
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
    CHAT_RATE_LIMIT_PER_MIN: "1000",
    PUBLIC_URL: PUBLIC,
    ADMIN_ORIGIN: "http://admin.test.local",
  } as NodeJS.ProcessEnv);
  app = await buildApp({
    db: appDb.db,
    config,
    gateway: createGatewayFromEnv({}).gateway,
    chatDistDir: dist,
    platform: new PlatformConfig(appDb.db, 30_000),
  });
  owner = await business("Smith Plumbing");
  await call("PUT", `${owner.base}/profile`, {
    businessName: "Smith & Sons Plumbing",
    phone: "519-555-0100",
    description: "Licensed plumbers serving Guelph.",
    serviceArea: "Guelph and Fergus",
    hours: { mon: [{ open: "08:00", close: "17:00" }] },
  });
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("services and products", () => {
  let first: string;
  let second: string;

  it("adds, lists in order, edits and reorders cards", async () => {
    const a = await call("POST", `${owner.base}/catalog`, {
      name: "Drain cleaning",
      priceText: "from $120",
      category: "Repairs",
      action: "quote",
    });
    expect(a.statusCode).toBe(201);
    expect(a.json().item).toMatchObject({
      name: "Drain cleaning",
      kind: "service",
      enabled: true,
      position: 0,
    });
    first = a.json().item.id;
    const b = await call("POST", `${owner.base}/catalog`, { name: "Water heater install", description: "" });
    expect(b.json().item).toMatchObject({ position: 1, description: null, action: "ask" });
    second = b.json().item.id;

    const edited = await call("PATCH", `${owner.base}/catalog/${second}`, { priceText: "call for a quote" });
    expect(edited.json().item.priceText).toBe("call for a quote");

    const reordered = await call("POST", `${owner.base}/catalog/order`, { ids: [second, first] });
    expect(reordered.json().items.map((i: { id: string }) => i.id)).toEqual([second, first]);
    // Every card, once each.
    expect((await call("POST", `${owner.base}/catalog/order`, { ids: [second] })).statusCode).toBe(400);
  });

  it("validates cards", async () => {
    expect((await call("POST", `${owner.base}/catalog`, { name: "" })).statusCode).toBe(400);
    expect((await call("POST", `${owner.base}/catalog`, { name: "x", action: "buy" })).statusCode).toBe(400);
    expect(
      (await call("POST", `${owner.base}/catalog`, { name: "x", priceText: "y".repeat(61) })).statusCode,
    ).toBe(400);
  });

  it("adds a photo by content type, replaces it, and removes it with the card", async () => {
    const res = await call("PUT", `${owner.base}/catalog/${first}/photo`, { data: PNG });
    expect(res.statusCode).toBe(200);
    const url = res.json().item.photoUrl as string;
    expect(url).toMatch(/\/v1\/public\/assets\//);
    const served = await app.inject({ method: "GET", url: url.replace(PUBLIC, "") });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");

    const notImage = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64");
    expect((await call("PUT", `${owner.base}/catalog/${first}/photo`, { data: notImage })).statusCode).toBe(
      400,
    );

    const replaced = await call("PUT", `${owner.base}/catalog/${first}/photo`, { data: PNG });
    const oldId = url.split("/").pop()!;
    expect((await ownerDb.db.select().from(assets).where(eq(assets.id, oldId))).length).toBe(0);
    const newId = (replaced.json().item.photoUrl as string).split("/").pop()!;

    const extra = await call("POST", `${owner.base}/catalog`, { name: "Temporary" });
    await call("PUT", `${owner.base}/catalog/${extra.json().item.id}/photo`, { data: PNG });
    expect((await call("DELETE", `${owner.base}/catalog/${extra.json().item.id}`)).statusCode).toBe(204);
    expect((await ownerDb.db.select().from(assets).where(eq(assets.id, newId))).length).toBe(1);
  });

  it("is not visible to other businesses", async () => {
    const other = await business("Other Plumbing");
    expect((await call("GET", `${owner.base}/catalog`, undefined, other.cookie)).statusCode).toBe(404);
    expect(
      (await call("PATCH", `${other.base}/catalog/${first}`, { name: "hacked" }, other.cookie)).statusCode,
    ).toBe(404);
  });
});

describe("notices", () => {
  it("adds notices with optional dates and validates them", async () => {
    const day = 86_400_000;
    const running = await call("POST", `${owner.base}/notices`, { text: "Booking furnace tune-ups now" });
    expect(running.statusCode).toBe(201);
    await call("POST", `${owner.base}/notices`, {
      text: "Closed for the holidays",
      startsAt: new Date(Date.now() + 10 * day).toISOString(),
    });
    await call("POST", `${owner.base}/notices`, {
      text: "Summer AC special",
      endsAt: new Date(Date.now() - day).toISOString(),
    });
    expect(
      (
        await call("POST", `${owner.base}/notices`, {
          text: "x",
          startsAt: new Date(Date.now() + day).toISOString(),
          endsAt: new Date().toISOString(),
        })
      ).statusCode,
    ).toBe(400);
    expect((await call("GET", `${owner.base}/notices`)).json().notices).toHaveLength(3);
  });
});

describe("business page", () => {
  it("is off until published, while the admin preview always works in an iframe", async () => {
    expect((await visit(`/c/${owner.publicKey}`)).statusCode).toBe(404);
    const preview = await app.inject({
      method: "GET",
      url: `/c/${owner.publicKey}?preview=1`,
      headers: { "sec-fetch-dest": "iframe" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain('<meta name="robots" content="noindex">');
  });

  it("shows the business's details, cards and running notices in the HTML", async () => {
    await call("PATCH", owner.base, { hostedPageEnabled: true });
    const page = await visit(`/c/${owner.publicKey}`);
    expect(page.statusCode).toBe(200);
    const html = page.body;
    expect(html).toContain('<h1 dir="auto">Smith &amp; Sons Plumbing</h1>');
    expect(html).toContain("Licensed plumbers serving Guelph.");
    expect(html).toContain("Drain cleaning");
    expect(html).toContain("from $120");
    expect(html.indexOf("Water heater install")).toBeLessThan(html.indexOf("Drain cleaning"));
    expect(html).toContain("Booking furnace tune-ups now");
    expect(html).not.toContain("Closed for the holidays");
    expect(html).not.toContain("Summer AC special");
    expect(html).toContain('"@type":"Plumber"');
    // A draft assistant's page isn't listed yet.
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(`<link rel="canonical" href="${PUBLIC}/c/${owner.publicKey}">`);
  });

  it("hides cards the owner turned off", async () => {
    const list = (await call("GET", `${owner.base}/catalog`)).json().items as { id: string; name: string }[];
    const water = list.find((i) => i.name === "Water heater install")!;
    await call("PATCH", `${owner.base}/catalog/${water.id}`, { enabled: false });
    expect((await visit(`/c/${owner.publicKey}`)).body).not.toContain("Water heater install");
    await call("PATCH", `${owner.base}/catalog/${water.id}`, { enabled: true });
  });

  it("is listed once the assistant is active, unless the owner keeps it unlisted", async () => {
    await call("PATCH", owner.base, { status: "active" });
    expect((await visit(`/c/${owner.publicKey}`)).body).toContain(
      '<meta name="robots" content="index, follow">',
    );
    const unlisted = await call("PATCH", owner.base, { settings: { page: { listed: false } } });
    expect(unlisted.json().bot.settings.page).toEqual({ listed: false });
    // Changing one page setting keeps the other.
    const personal = await call("PATCH", owner.base, { settings: { page: { preset: "personal" } } });
    expect(personal.json().bot.settings.page).toEqual({ listed: false, preset: "personal" });
    const page = (await visit(`/c/${owner.publicKey}`)).body;
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain('data-preset="personal"');
    await call("PATCH", owner.base, { settings: { page: { listed: true, preset: "business" } } });
  });

  it("serves the plain chat for iframes and the widget", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/c/${owner.publicKey}?embed=inline`,
      headers: { "sec-fetch-dest": "iframe" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("tbp-hero");
    expect(res.body).toContain('id="tb-boot"');
  });
});

describe("friendly page links", () => {
  it("sets a link that opens the page and becomes its canonical address", async () => {
    const res = await call("PATCH", owner.base, { pageSlug: ` ${slug.toUpperCase()} ` });
    expect(res.statusCode).toBe(200);
    expect(res.json().bot.pageSlug).toBe(slug);
    const page = await visit(`/${slug}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`<link rel="canonical" href="${PUBLIC}/${slug}">`);
    expect(page.body).toContain(`"publicKey":"${owner.publicKey}"`);
    expect((await visit(`/c/${owner.publicKey}`)).body).toContain(`href="${PUBLIC}/${slug}"`);
  });

  it("rejects malformed and reserved links", async () => {
    for (const bad of ["ab", "-smith", "smith--plumbing", "smith_plumbing", "admin", "v1"]) {
      expect((await call("PATCH", owner.base, { pageSlug: bad })).statusCode, bad).toBe(400);
    }
  });

  it("gives each link to one business only", async () => {
    const other = await business("Copycat Plumbing");
    const taken = await call("PATCH", other.base, { pageSlug: slug }, other.cookie);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe("slug_taken");
    // Saving the same link again on its own assistant is fine.
    expect((await call("PATCH", owner.base, { pageSlug: slug })).statusCode).toBe(200);
  });

  it("follows the web version switch and unknown links show nothing", async () => {
    await call("PATCH", owner.base, { hostedPageEnabled: false });
    expect((await visit(`/${slug}`)).statusCode).toBe(404);
    await call("PATCH", owner.base, { hostedPageEnabled: true });
    expect((await visit("/no-such-business-page")).statusCode).toBe(404);
    // Paths that can't be page links keep the API's plain 404.
    const plain = await app.inject({ method: "GET", url: "/robots.txt" });
    expect(plain.statusCode).toBe(404);
    expect(plain.headers["content-type"]).toContain("application/json");
  });

  it("can remove the link", async () => {
    expect((await call("PATCH", owner.base, { pageSlug: null })).json().bot.pageSlug).toBeNull();
    expect((await visit(`/${slug}`)).statusCode).toBe(404);
  });
});
