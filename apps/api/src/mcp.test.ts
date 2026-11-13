import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createDb, type DbHandle, plans, runMigrations } from "@traiblazer/db";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { cities, industries } from "@traiblazer/marketing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
const SITE = "https://site.test";
const TEST_PLAN = `t_${crypto.randomUUID().slice(0, 8)}`;

let appDb: DbHandle;
let ownerDb: DbHandle;
let app: FastifyInstance;
let endpoint: URL;

const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_URL: "http://chat.test.local",
  SITE_URL: SITE,
  BUSINESS_EMAIL: "hello@site.test",
  PLATFORM_CACHE_SECONDS: "0",
} as NodeJS.ProcessEnv);

/** Connects a real MCP client over HTTP, the way an AI assistant would. */
async function connect(mode: "auto" | "legacy") {
  const client = new Client({ name: "mcp-test", version: "1.0.0" }, { versionNegotiation: { mode } });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  return client;
}

beforeAll(async () => {
  await runMigrations(ownerUrl);
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  await ownerDb.db.insert(plans).values([
    {
      id: TEST_PLAN,
      nameEn: "Test plan",
      nameFr: "Forfait test",
      monthlyQuestions: 1234,
      concurrent: 2,
      perMinute: 10,
      priceMonthlyCents: 4200,
      sortOrder: 9000,
    },
    {
      id: `${TEST_PLAN}_off`,
      nameEn: "Retired plan",
      nameFr: "Ancien forfait",
      monthlyQuestions: 1,
      concurrent: 1,
      perMinute: 1,
      priceMonthlyCents: 100,
      active: false,
      sortOrder: 9001,
    },
  ]);
  app = await buildApp({ db: appDb.db, config, gateway: createGatewayFromEnv({}) });
  // A real port: the client under test speaks HTTP, not Fastify's inject.
  await app.listen({ port: 0, host: "127.0.0.1" });
  endpoint = new URL(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}/mcp`);
});

afterAll(async () => {
  await app?.close();
  await ownerDb.db.delete(plans).where(eq(plans.id, TEST_PLAN));
  await ownerDb.db.delete(plans).where(eq(plans.id, `${TEST_PLAN}_off`));
  await appDb?.close();
  await ownerDb?.close();
});

describe("public MCP server", () => {
  it("lists read-only tools to a current client", async () => {
    const client = await connect("auto");
    expect(client.getServerVersion()?.name).toBe("traiblazer");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "check_city_served",
      "get_company_info",
      "get_pricing",
      "get_started",
      "list_cities",
      "list_industries",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
    await client.close();
  });

  it("answers company, industry and city questions from the marketing data", async () => {
    const client = await connect("auto");

    const company = await client.callTool({ name: "get_company_info", arguments: {} });
    expect(company.isError).toBeFalsy();
    const info = company.structuredContent as { name: string; website: string; contact: { email?: string } };
    expect(info.name).toBe("Traiblazer");
    expect(info.website).toBe(SITE);
    expect(info.contact).toEqual({ email: "hello@site.test" });

    const listed = await client.callTool({ name: "list_industries", arguments: { language: "fr" } });
    const { industries: rows } = listed.structuredContent as { industries: { id: string; name: string }[] };
    expect(rows.map((row) => row.id)).toEqual(industries.map((industry) => industry.slug));
    expect(rows[0]?.name).toBe(industries[0]?.name.fr);

    const served = await client.callTool({ name: "list_cities", arguments: {} });
    const { cities: cityRows } = served.structuredContent as { cities: { id: string; page: string }[] };
    expect(cityRows.map((row) => row.id)).toEqual(cities.map((city) => city.slug));
    expect(cityRows[0]?.page).toBe(`${SITE}/en/local/thunder-bay`);
    await client.close();
  });

  it("publishes the active plans and their prices, and no others", async () => {
    const client = await connect("auto");
    const pricing = await client.callTool({ name: "get_pricing", arguments: {} });
    const data = pricing.structuredContent as {
      currency: string;
      plans: { id: string; priceMonthly: number | null; monthlyQuestions: number }[];
    };
    expect(data.currency).toBe("CAD");
    expect(data.plans.find((plan) => plan.id === TEST_PLAN)).toMatchObject({
      priceMonthly: 42,
      monthlyQuestions: 1234,
    });
    expect(data.plans.some((plan) => plan.id === `${TEST_PLAN}_off`)).toBe(false);
    await client.close();
  });

  it("checks cities, nearby communities and places without a page", async () => {
    const client = await connect("auto");
    const check = async (city: string) =>
      (await client.callTool({ name: "check_city_served", arguments: { city } })).structuredContent as {
        hasLocalPage: boolean;
        availableOnline: boolean;
        matched?: string;
        city?: { id: string };
      };

    expect(await check("thunder bay, ON")).toMatchObject({
      hasLocalPage: true,
      matched: "city",
      city: { id: "thunder-bay" },
    });
    expect(await check("Kakabeka Falls")).toMatchObject({
      hasLocalPage: true,
      matched: "nearby_community",
      city: { id: "thunder-bay" },
    });
    expect(await check("Sault Sainte Marie")).toMatchObject({ city: { id: "sault-ste-marie" } });
    expect(await check("Moose Jaw")).toMatchObject({ hasLocalPage: false, availableOnline: true });

    const bad = await client.callTool({ name: "check_city_served", arguments: { city: "" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });

  it("also serves clients that still use the 2025 handshake", async () => {
    const client = await connect("legacy");
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    const started = await client.callTool({ name: "get_started", arguments: {} });
    expect((started.structuredContent as { signup: string }).signup).toBe(`${SITE}/signup`);
    await client.close();
  });

  it("has no sessions, allows any website to call it, and ignores cookies", async () => {
    const get = await fetch(endpoint, { headers: { accept: "text/event-stream" } });
    expect(get.status).toBe(405);
    expect(get.headers.get("mcp-session-id")).toBeNull();

    const preflight = await fetch(endpoint, {
      method: "OPTIONS",
      headers: { origin: "https://assistant.example", "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    // A browser on another site, with a (bogus) session cookie: still just the public answer.
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin: "https://assistant.example",
        cookie: "tb_session=not-a-session",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "probe", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(6);
  });
});
