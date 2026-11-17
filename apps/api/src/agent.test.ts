import { createDb, type DbHandle, jobs, tenants, usageEvents, users } from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  type ContentBlock,
  createGatewayFromEnv,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
  type ToolResultBlock,
} from "@traiblazer/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { toModelMessages } from "./routes/agent.js";
import { newTenant, newUser } from "./test-helpers.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

interface ScriptedTurn {
  text?: string;
  calls?: { name: string; input: unknown }[];
}

/** A model that calls tools: each request gets the turn `script` returns for it. */
class ToolProvider implements LLMProvider {
  readonly id = "tools";
  requests: ChatRequest[] = [];
  script: (request: ChatRequest, call: number) => ScriptedTurn = () => ({ text: "ok" });
  supportsImages() {
    return false;
  }
  supportsTools() {
    return true;
  }
  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push({ ...request, messages: [...request.messages] });
    const call = this.requests.length;
    const turn = this.script(request, call);
    if (turn.text) yield { type: "text", text: turn.text };
    const content: ContentBlock[] = [
      ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
      ...(turn.calls ?? []).map((c, i) => ({ type: "tool_call" as const, id: `call_${call}_${i}`, ...c })),
    ];
    yield {
      type: "done",
      model,
      stopReason: turn.calls?.length ? "tool_use" : "end",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      message: { role: "assistant", content },
    };
  }
}

/** Plays a list of turns, one per request, in order. */
function play(provider: ToolProvider, turns: ((request: ChatRequest) => ScriptedTurn)[]) {
  provider.requests = [];
  provider.script = (request, call) => turns[call - 1]!(request);
}

const results = (request: ChatRequest): ToolResultBlock[] => {
  const latest = request.messages.at(-1)!.content;
  return typeof latest === "string"
    ? []
    : latest.filter((b): b is ToolResultBlock => b.type === "tool_result");
};

const provider = new ToolProvider();
const gateway = new LLMGateway({
  providers: [provider, new OfflineProvider()],
  routes: {
    chat: [{ provider: "offline", model: "default" }],
    aux: [{ provider: "offline", model: "echo" }],
    agent: [{ provider: "tools", model: "t1" }],
  },
});

const config = loadConfig({
  NODE_ENV: "test",
  AUTH_RATE_LIMIT_PER_MIN: "1000",
  CHAT_RATE_LIMIT_PER_MIN: "1000",
  PUBLIC_URL: "http://chat.test.local",
  ADMIN_ORIGIN: "http://admin.test.local",
} as NodeJS.ProcessEnv);

let app: FastifyInstance;
let appDb: DbHandle;
let ownerDb: DbHandle;
let cookie: string;
let tenantId: string;
let botId: string;
const emails: string[] = [];
const tenantIds: string[] = [];

const base = () => `/v1/tenants/${tenantId}/bots/${botId}`;
const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, headers = { cookie }) =>
  app.inject({ method, url, headers, payload: payload as object | undefined });
const ask = (text: string, headers = { cookie }) =>
  call("POST", `${base()}/agent`, { messages: [{ role: "user", text }], language: "en" }, headers);

beforeAll(async () => {
  ownerDb = createDb(ownerUrl, { max: 1 });
  appDb = createDb(appUrl, { max: 5 });
  app = await buildApp({ db: appDb.db, config, gateway });

  cookie = await newUser(app, emails, "agent-owner");
  tenantId = await newTenant(app, tenantIds, cookie, "Maple Bakery");
  const created = await call("POST", `/v1/tenants/${tenantId}/bots`, {
    name: "Maple Bakery",
    pack: "cafe-bakery",
  });
  botId = created.json().bot.id;
  await call("PUT", `${base()}/profile`, {
    hours: { mon: [{ open: "08:00", close: "17:00" }], sat: [] },
    phone: "807-555-0142",
  });
});

afterAll(async () => {
  if (tenantIds.length) await ownerDb?.db.delete(tenants).where(inArray(tenants.id, tenantIds));
  if (emails.length) await ownerDb?.db.delete(users).where(inArray(users.email, emails));
  await app?.close();
  await appDb?.close();
  await ownerDb?.close();
});

describe("owner agent", () => {
  it("joins the conversation into turns the model can read", () => {
    expect(
      toModelMessages([
        { role: "assistant", text: "Hi! What changed?" },
        { role: "user", text: "Hours" },
        { role: "user", text: "Saturdays" },
        { role: "assistant", text: "Which hours?" },
        { role: "user", text: "10 to 2" },
      ]),
    ).toEqual([
      { role: "user", content: "Hours\n\nSaturdays" },
      { role: "assistant", content: "Which hours?" },
      { role: "user", content: "10 to 2" },
    ]);
  });

  it("changes the opening hours and says what it changed", async () => {
    play(provider, [
      () => ({ calls: [{ name: "get_business_details", input: {} }] }),
      (request) => {
        const details = JSON.parse(results(request)[0]!.content);
        expect(details.hours.Monday).toBe("08:00–17:00");
        expect(details.hours.Saturday).toBe("closed");
        return {
          calls: [
            { name: "set_opening_hours", input: { days: { sat: [{ open: "10:00", close: "14:00" }] } } },
          ],
        };
      },
      () => ({ text: "Done: Saturdays are now 10:00–14:00." }),
    ]);

    const res = await ask("We're open Saturdays 10 to 2 now");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: "Done: Saturdays are now 10:00–14:00.",
      changes: [{ area: "business", summary: "Opening hours updated: Saturday" }],
    });

    const profile = (await call("GET", base())).json().profile;
    expect(profile.hours).toEqual({
      mon: [{ open: "08:00", close: "17:00" }],
      sat: [{ open: "10:00", close: "14:00" }],
    });

    // The agent was told about the business and given its tools.
    const system = provider.requests[0]!.system.map((b) => b.text).join("\n");
    expect(system).toContain("Business: Maple Bakery");
    expect(system).toContain("Time zone: America/Toronto");
    expect(provider.requests[0]!.tools!.map((t) => t.name)).toEqual(
      expect.arrayContaining(["set_opening_hours", "update_interview_answers", "add_answer", "add_notice"]),
    );

    const [usage] = await ownerDb.db
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.tenantId, tenantId), eq(usageEvents.kind, "llm.agent")));
    expect(usage?.metadata).toMatchObject({
      task: "owner_agent",
      modelCalls: 3,
      tools: ["get_business_details", "set_opening_hours"],
    });
  });

  it("updates one interview answer and keeps the others", async () => {
    const interview = (await call("GET", `${base()}/interview`)).json();
    const [first, second] = interview.questions as { key: string }[];
    expect(second).toBeDefined();
    await call("PUT", `${base()}/interview`, { answers: { [first!.key]: "Old answer" } });

    play(provider, [
      () => ({ calls: [{ name: "get_interview", input: {} }] }),
      (request) => {
        const questions = JSON.parse(results(request)[0]!.content) as {
          key: string;
          answer: string | null;
        }[];
        expect(questions.find((q) => q.key === first!.key)?.answer).toBe("Old answer");
        return {
          calls: [
            { name: "update_interview_answers", input: { answers: { nope: "x" } } },
            {
              name: "update_interview_answers",
              input: { answers: { [second!.key]: "Free parking behind the shop." } },
            },
          ],
        };
      },
      (request) => {
        const [unknown, saved] = results(request);
        expect(unknown!.isError).toBe(true);
        expect(unknown!.content).toContain("Unknown question key: nope");
        expect(saved!.isError).toBeUndefined();
        return { text: "Saved." };
      },
    ]);

    const res = await ask("Parking is free behind the shop");
    expect(res.json().changes).toEqual([{ area: "interview", summary: "Interview answers updated (1)" }]);
    const after = (await call("GET", `${base()}/interview`)).json();
    expect(after.answers).toEqual({
      [first!.key]: "Old answer",
      [second!.key]: "Free parking behind the shop.",
    });
    // The changed source is read again by the worker.
    const queued = await ownerDb.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, "source.sync")));
    expect(queued.length).toBeGreaterThan(0);
  });

  it("adds an answer to a common question and a holiday notice", async () => {
    play(provider, [
      () => ({
        calls: [
          {
            name: "add_answer",
            input: { question: "Do you have gluten-free bread?", answer: "Yes, on Fridays.", language: "en" },
          },
          {
            name: "add_notice",
            input: {
              text: "Closed on December 25.",
              startsAt: "2026-12-20T00:00:00-05:00",
              endsAt: "2026-12-26T00:00:00-05:00",
            },
          },
        ],
      }),
      () => ({ text: "Added both." }),
    ]);

    const res = await ask("Add that we do gluten-free on Fridays, and that we're closed Christmas");
    expect(res.json().changes).toEqual([
      { area: "answers", summary: 'Answer added: "Do you have gluten-free bread?"' },
      { area: "notices", summary: 'Notice added: "Closed on December 25."' },
    ]);
    const pairs = (await call("GET", `${base()}/qa`)).json().pairs;
    expect(pairs).toEqual([
      expect.objectContaining({ question: "Do you have gluten-free bread?", enabled: true }),
    ]);
    const notices = (await call("GET", `${base()}/notices`)).json().notices;
    expect(notices).toEqual([expect.objectContaining({ text: "Closed on December 25.", kind: "notice" })]);
  });

  it("is only for the business's own people", async () => {
    const stranger = await newUser(app, emails, "agent-stranger");
    const res = await ask("Change the hours", { cookie: stranger });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("refuses a conversation that doesn't end with the person", async () => {
    const res = await call("POST", `${base()}/agent`, { messages: [{ role: "assistant", text: "Hi" }] });
    expect(res.statusCode).toBe(400);
  });

  it("says so when no model can use tools", async () => {
    const offline = await buildApp({ db: appDb.db, config, gateway: createGatewayFromEnv({}).gateway });
    try {
      const res = await offline.inject({
        method: "POST",
        url: `${base()}/agent`,
        headers: { cookie },
        payload: { messages: [{ role: "user", text: "Hi" }] },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe("agent_unavailable");
    } finally {
      await offline.close();
    }
  });
});
