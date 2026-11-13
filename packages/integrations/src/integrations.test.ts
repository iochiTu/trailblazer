import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ConnectorError,
  type CrmLead,
  connectorInfo,
  connectors,
  getConnector,
  hmacHex,
  leadNotes,
  leadTitle,
  loadIntegrationsConfig,
  open,
  parseSecretKey,
  readToken,
  seal,
  signToken,
  splitName,
} from "./index.js";

const lead: CrmLead = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "quote",
  name: "Jean-Luc Tremblay",
  email: "JL@example.com",
  phone: "(807) 555-0142",
  bestTime: "after 5 pm",
  message: "Water heater is leaking, wants a replacement quote.",
  language: "fr",
  urgent: true,
  details: [{ key: "address", label: "Address", value: "12 Pine St" }],
  photoCount: 2,
  createdAt: new Date("2026-11-13T15:00:00Z"),
  businessName: "Maple Plumbing",
  ownerLanguage: "en",
  requestUrl: "https://admin.example/t/t1/bots/b1?tab=requests",
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fake `fetch` that records calls and answers from a list of [url fragment, status, body] rules. */
function fakeFetch(rules: [match: string | ((call: Call) => boolean), status: number, body?: unknown][]) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const rule = rules.find(([match]) =>
      typeof match === "string" ? call.url.includes(match) || call.body.includes(match) : match(call),
    );
    if (!rule) return new Response("no rule", { status: 599 });
    return new Response(rule[2] === undefined ? "" : JSON.stringify(rule[2]), { status: rule[1] });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const connector = (id: string) => getConnector(id)!;

describe("sealing credentials", () => {
  const key = randomBytes(32);

  it("round-trips and hides the content", () => {
    const sealed = seal(key, { apiKey: "super-secret" }, "ctx");
    expect(sealed).not.toContain("super-secret");
    expect(open(key, sealed, "ctx")).toEqual({ apiKey: "super-secret" });
    expect(seal(key, { apiKey: "super-secret" }, "ctx")).not.toBe(sealed);
  });

  it("refuses another key, another context and tampering", () => {
    const sealed = seal(key, { a: 1 }, "tenant-a");
    expect(() => open(randomBytes(32), sealed, "tenant-a")).toThrow();
    expect(() => open(key, sealed, "tenant-b")).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("x".repeat(12)).toString("base64url");
    expect(() => open(key, parts.join("."), "tenant-a")).toThrow();
    expect(() => open(key, "garbage", "tenant-a")).toThrow();
  });

  it("reads hex and base64 keys, and rejects short ones", () => {
    expect(parseSecretKey(undefined)).toBeNull();
    expect(parseSecretKey(key.toString("hex"))?.equals(key)).toBe(true);
    expect(parseSecretKey(key.toString("base64"))?.equals(key)).toBe(true);
    expect(() => parseSecretKey("too-short")).toThrow(/32 bytes/);
  });

  it("signs short-lived state tokens", () => {
    const token = signToken(key, { t: "tenant", u: "user" }, 60_000, 1_000);
    expect(readToken(key, token, 2_000)).toMatchObject({ t: "tenant", u: "user" });
    expect(readToken(key, token, 62_000)).toBeNull();
    expect(readToken(randomBytes(32), token, 2_000)).toBeNull();
    const [body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ t: "other", u: "user", exp: 9e15 })).toString("base64url");
    expect(readToken(key, `${forged}.${signature}`, 2_000)).toBeNull();
    expect(readToken(key, body!, 2_000)).toBeNull();
  });
});

describe("lead text", () => {
  it("writes a title and notes staff can act on", () => {
    expect(leadTitle(lead)).toBe("URGENT · Quote request: Jean-Luc Tremblay");
    const notes = leadNotes(lead);
    expect(notes).toContain("Water heater is leaking");
    expect(notes).toContain("Address: 12 Pine St");
    expect(notes).toContain("Best time to reach: after 5 pm");
    expect(notes).toContain("2 photos sent");
    expect(notes).toContain(lead.requestUrl);
    expect(leadTitle({ ...lead, urgent: false, ownerLanguage: "fr" })).toBe(
      "Demande de soumission: Jean-Luc Tremblay",
    );
  });

  it("splits names", () => {
    expect(splitName("Jean-Luc  Tremblay")).toEqual({ first: "Jean-Luc", last: "Tremblay" });
    expect(splitName("Mary Ann Smith")).toEqual({ first: "Mary Ann", last: "Smith" });
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "" });
  });
});

describe("registry", () => {
  it("knows which connectors this server can use", () => {
    const none = loadIntegrationsConfig({});
    expect(connectors.every((c) => !connectorInfo(c, none).available)).toBe(true);

    const config = loadIntegrationsConfig({ INTEGRATIONS_SECRET_KEY: randomBytes(32).toString("hex") });
    const available = (id: string) => connectorInfo(connector(id), config).available;
    expect(available("webhook")).toBe(true);
    expect(available("housecall-pro")).toBe(true);
    // These need the platform's own keys (developer app, partner app key).
    expect(available("jobber")).toBe(false);
    expect(available("servicetitan")).toBe(false);

    const full = loadIntegrationsConfig({
      INTEGRATIONS_SECRET_KEY: randomBytes(32).toString("hex"),
      JOBBER_CLIENT_ID: "id",
      JOBBER_CLIENT_SECRET: "secret",
      SERVICETITAN_APP_KEY: "ak1.x",
    });
    expect(connectors.every((c) => connectorInfo(c, full).available)).toBe(true);
    expect(JSON.stringify(connectorInfo(connector("jobber"), full))).not.toContain('secret"');
  });
});

describe("webhook", () => {
  const now = () => new Date("2026-11-13T16:00:00Z");

  it("posts a signed request", async () => {
    const { fetch, calls } = fakeFetch([["hooks.example", 200]]);
    const credentials = { url: "https://hooks.example/catch/1", secret: "s3cret" };
    await connector("webhook").pushLead({ credentials, platform: {}, fetch, now }, lead);
    const call = calls[0]!;
    const payload = JSON.parse(call.body);
    expect(payload).toMatchObject({
      version: 1,
      event: "request.created",
      request: {
        id: lead.id,
        kind: "quote",
        urgent: true,
        phone: lead.phone,
        details: { address: "12 Pine St" },
      },
    });
    const timestamp = call.headers["x-traiblazer-timestamp"]!;
    expect(call.headers["x-traiblazer-signature"]).toBe(
      `sha256=${hmacHex("s3cret", `${timestamp}.${call.body}`)}`,
    );
  });

  it("checks the address with a ping, and insists on https", async () => {
    const { fetch, calls } = fakeFetch([["hooks.example", 200]]);
    const verify = (url: string) =>
      connector("webhook").verify({ credentials: { url }, platform: {}, fetch });
    expect(await verify("https://hooks.example/catch/1")).toEqual({ accountName: "hooks.example" });
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ event: "ping", request: null });
    expect(calls[0]!.headers["x-traiblazer-signature"]).toBeUndefined();
    await expect(verify("http://hooks.example/catch/1")).rejects.toMatchObject({ failure: "rejected" });
    await expect(verify("not a url")).rejects.toBeInstanceOf(ConnectorError);
  });

  it("tells a deleted hook from an outage", async () => {
    const push = (status: number) =>
      connector("webhook").pushLead(
        {
          credentials: { url: "https://hooks.example/x" },
          platform: {},
          fetch: fakeFetch([["hooks", status]]).fetch,
        },
        lead,
      );
    await expect(push(410)).rejects.toMatchObject({ failure: "auth" });
    await expect(push(503)).rejects.toMatchObject({ failure: "temporary" });
    await expect(push(400)).rejects.toMatchObject({ failure: "rejected" });
  });
});

describe("Housecall Pro", () => {
  const credentials = { apiKey: "hcp-key" };

  it("creates a lead with a new customer", async () => {
    const { fetch, calls } = fakeFetch([
      ["/customers?", 200, { customers: [{ id: "cus_other", email: "someone@else.example" }] }],
      ["/leads", 201, { id: "lead_9" }],
    ]);
    const result = await connector("housecall-pro").pushLead({ credentials, platform: {}, fetch }, lead);
    expect(result.externalId).toBe("lead_9");
    expect(calls.every((c) => c.headers.authorization === "Token hcp-key")).toBe(true);
    const body = JSON.parse(calls.at(-1)!.body);
    expect(body.customer).toMatchObject({ first_name: "Jean-Luc", last_name: "Tremblay", email: lead.email });
    expect(body.note).toContain("Water heater");
    expect(body.tags).toEqual(["Urgent"]);
  });

  it("reuses a customer with the same phone", async () => {
    const { fetch, calls } = fakeFetch([
      ["/customers?", 200, { customers: [{ id: "cus_1", mobile_number: "+1 807-555-0142" }] }],
      ["/leads", 201, { id: "lead_10" }],
    ]);
    await connector("housecall-pro").pushLead({ credentials, platform: {}, fetch }, { ...lead, email: null });
    const body = JSON.parse(calls.at(-1)!.body);
    expect(body.customer_id).toBe("cus_1");
    expect(body.customer).toBeUndefined();
  });

  it("reports a refused key", async () => {
    const { fetch } = fakeFetch([["/company", 401, { error: "unauthorized" }]]);
    await expect(
      connector("housecall-pro").verify({ credentials, platform: {}, fetch }),
    ).rejects.toMatchObject({ failure: "auth", status: 401 });
  });
});

describe("Jobber", () => {
  const platform = { jobber: { clientId: "cid", clientSecret: "csecret" } };
  const now = () => new Date("2026-11-13T16:00:00Z");
  const fresh = { accessToken: "at", refreshToken: "rt", expiresAt: String(now().getTime() + 3_600_000) };

  it("builds the sign-in address and exchanges the code", async () => {
    const oauth = connector("jobber").oauth!;
    const url = new URL(
      oauth.authorizeUrl({ platform, redirectUri: "https://admin.example/cb", state: "st" }),
    );
    expect(url.origin + url.pathname).toBe("https://api.getjobber.com/api/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "https://admin.example/cb",
      state: "st",
    });

    const { fetch, calls } = fakeFetch([
      ["/oauth/token", 200, { access_token: "at1", refresh_token: "rt1", expires_in: 3600 }],
    ]);
    const credentials = await oauth.exchangeCode({
      platform,
      fetch,
      code: "c0de",
      redirectUri: "https://admin.example/cb",
      now,
    });
    expect(credentials).toEqual({
      accessToken: "at1",
      refreshToken: "rt1",
      expiresAt: String(now().getTime() + 3_600_000),
    });
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toMatchObject({
      grant_type: "authorization_code",
      code: "c0de",
      client_secret: "csecret",
    });
  });

  it("refreshes only when the token is about to run out, and keeps the rotated refresh token", async () => {
    const { fetch, calls } = fakeFetch([
      ["/oauth/token", 200, { access_token: "at2", refresh_token: "rt2", expires_in: 3600 }],
    ]);
    const refresh = connector("jobber").refresh!;
    expect(await refresh({ credentials: fresh, platform, fetch, now })).toBeNull();
    expect(calls).toHaveLength(0);
    const stale = { ...fresh, expiresAt: String(now().getTime() + 60_000) };
    expect(await refresh({ credentials: stale, platform, fetch, now })).toMatchObject({
      accessToken: "at2",
      refreshToken: "rt2",
    });
    expect(new URLSearchParams(calls[0]!.body).get("refresh_token")).toBe("rt");
  });

  it("asks the owner to connect again when the refresh token is refused", async () => {
    const { fetch } = fakeFetch([["/oauth/token", 400, { error: "invalid_grant" }]]);
    await expect(
      connector("jobber").refresh!({ credentials: { ...fresh, expiresAt: "0" }, platform, fetch, now }),
    ).rejects.toMatchObject({ failure: "auth" });
  });

  it("creates a client, a request and a note", async () => {
    const { fetch, calls } = fakeFetch([
      ["FindClient", 200, { data: { clients: { nodes: [] } } }],
      ["CreateClient", 200, { data: { clientCreate: { client: { id: "c1" }, userErrors: [] } } }],
      [
        "CreateRequest(",
        200,
        {
          data: {
            requestCreate: {
              request: { id: "r1", jobberWebUri: "https://secure.getjobber.com/requests/1" },
              userErrors: [],
            },
          },
        },
      ],
      ["CreateRequestNote", 200, { data: { requestCreateNote: { userErrors: [] } } }],
    ]);
    const result = await connector("jobber").pushLead({ credentials: fresh, platform, fetch, now }, lead);
    expect(result).toEqual({ externalId: "r1", externalUrl: "https://secure.getjobber.com/requests/1" });
    expect(calls[0]!.headers.authorization).toBe("Bearer at");
    expect(calls[0]!.headers["x-jobber-graphql-version"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const bodies = calls.map((c) => JSON.parse(c.body));
    const create = bodies.find((b) => b.query.includes("CreateClient"))!;
    expect(create.variables.input).toMatchObject({
      firstName: "Jean-Luc",
      lastName: "Tremblay",
      emails: [{ address: lead.email, primary: true }],
      phones: [{ number: lead.phone, primary: true }],
    });
    expect(bodies.find((b) => b.query.includes("CreateRequest("))!.variables.input).toEqual({
      clientId: "c1",
      title: "URGENT · Quote request: Jean-Luc Tremblay",
    });
    expect(bodies.at(-1)!.variables).toMatchObject({ requestId: "r1" });
    expect(bodies.at(-1)!.variables.input.message).toContain("Water heater");
  });

  it("reuses a client matched by email and reports Jobber's own errors", async () => {
    const found = { data: { clients: { nodes: [{ id: "c7", emails: [{ address: "jl@example.com" }] }] } } };
    const { fetch, calls } = fakeFetch([
      ["FindClient", 200, found],
      [
        "CreateRequest(",
        200,
        { data: { requestCreate: { request: null, userErrors: [{ message: "Title is too long" }] } } },
      ],
    ]);
    await expect(
      connector("jobber").pushLead({ credentials: fresh, platform, fetch, now }, lead),
    ).rejects.toMatchObject({ failure: "rejected", message: expect.stringContaining("Title is too long") });
    expect(calls.some((c) => c.body.includes("CreateClient"))).toBe(false);
    expect(JSON.parse(calls.at(-1)!.body).variables.input.clientId).toBe("c7");

    const throttled = fakeFetch([
      ["account", 200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }],
    ]);
    await expect(
      connector("jobber").verify({ credentials: fresh, platform, fetch: throttled.fetch, now }),
    ).rejects.toMatchObject({ failure: "temporary" });
  });
});

describe("ServiceTitan", () => {
  const platform = { serviceTitan: { appKey: "ak1.app", environment: "integration" as const } };
  const now = () => new Date("2026-11-13T16:00:00Z");
  const saved = { tenantId: "123", clientId: "cid", clientSecret: "csecret" };

  it("gets a token and the booking provider, then reuses them", async () => {
    const { fetch, calls } = fakeFetch([
      ["/connect/token", 200, { access_token: "tok", expires_in: 900 }],
      ["/booking-provider-tags", 200, { data: [{ id: 77 }] }],
    ]);
    const refresh = connector("servicetitan").refresh!;
    const credentials = await refresh({ credentials: saved, platform, fetch, now });
    expect(credentials).toMatchObject({ ...saved, accessToken: "tok", bookingProviderId: "77" });
    expect(calls[0]!.url).toBe("https://auth-integration.servicetitan.io/connect/token");
    expect(calls[1]!.headers).toMatchObject({ authorization: "tok", "st-app-key": "ak1.app" });
    expect(await refresh({ credentials: credentials!, platform, fetch, now })).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("treats a wrong client secret as a broken connection", async () => {
    const { fetch } = fakeFetch([["/connect/token", 400, { error: "invalid_client" }]]);
    await expect(
      connector("servicetitan").refresh!({ credentials: saved, platform, fetch, now }),
    ).rejects.toMatchObject({ failure: "auth" });
  });

  it("creates a booking", async () => {
    const { fetch, calls } = fakeFetch([["/bookings", 200, { id: 4521 }]]);
    const credentials = { ...saved, accessToken: "tok", bookingProviderId: "77" };
    const result = await connector("servicetitan").pushLead({ credentials, platform, fetch, now }, lead);
    expect(result.externalId).toBe("4521");
    expect(calls[0]!.url).toBe(
      "https://api-integration.servicetitan.io/crm/v2/tenant/123/booking-provider/77/bookings",
    );
    expect(JSON.parse(calls[0]!.body)).toMatchObject({
      name: lead.name,
      externalId: lead.id,
      isFirstTimeClient: true,
      priority: "Urgent",
      contacts: [
        { type: "Phone", value: "8075550142" },
        { type: "Email", value: lead.email },
      ],
    });
  });
});
