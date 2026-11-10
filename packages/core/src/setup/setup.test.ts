import {
  bots,
  createDb,
  type DbHandle,
  knowledgeSources,
  runMigrations,
  setupRuns,
  tenants,
  usageEvents,
  withTenant,
} from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  LLMGateway,
  type LLMProvider,
  type ModelRoute,
  OfflineProvider,
} from "@traiblazer/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexDocuments } from "../knowledge/index-documents.js";
import {
  basicSuggestion,
  buildSetupRequest,
  extractJson,
  readSuggestion,
  runSetup,
  SETUP_ERRORS,
  SETUP_LIMITS,
  type SetupPage,
  selectPages,
} from "./setup.js";

const pages: SetupPage[] = [
  {
    url: "https://cafe.example/",
    title: "Northern Lights Café",
    content:
      "Cozy café on the Thunder Bay waterfront. Call us at (807) 555-0123 or hello@northernlights.example.",
  },
  {
    url: "https://cafe.example/hours",
    title: "Hours",
    content:
      "We are open Monday to Friday from 7 am to 4 pm, and Saturday 8 am to 2 pm. Closed Sundays.\nFind us at 12 Water Street, Thunder Bay.",
  },
  { url: "https://cafe.example/blog/2019/spring", title: "Spring news", content: "We repainted the patio." },
];

const hours = {
  mon: [{ open: "7:00", close: "16:00" }],
  tue: [{ open: "07:00", close: "16:00" }],
  wed: [{ open: "07:00", close: "16:00" }],
  thu: [{ open: "07:00", close: "16:00" }],
  fri: [{ open: "07:00", close: "16:00" }],
  sat: [{ open: "08:00", close: "14:00" }],
  sun: [],
};
/** What a careful model returns for the pages above. */
const goodReply = {
  businessName: "Northern Lights Café",
  phone: "807-555-0123",
  email: "Hello@NorthernLights.example",
  address: "12 Water Street, Thunder Bay",
  addressQuote: "Find us at 12 Water Street, Thunder Bay.",
  hours,
  hoursQuote: "We are open Monday to Friday from 7 am to 4 pm, and Saturday 8 am to 2 pm. Closed Sundays.",
  greeting: { en: "Welcome to Northern Lights Café! Ask me about our hours and menu.", de: "Willkommen!" },
  quickReplies: {
    en: ["What are your hours?", "Where are you?", "What are your hours?"],
    fr: ["Vos heures ?"],
  },
  missing: ["Do you have parking?", "Do you take reservations?"],
};

describe("setup assistant: reading", () => {
  it("reads the home page and contact pages first, within the budget", () => {
    const picked = selectPages([pages[2]!, pages[1]!, pages[0]!]);
    expect(picked.map((p) => p.title)).toEqual(["Northern Lights Café", "Hours", "Spring news"]);

    // The owner's own notes count like the home page; long pages are cut; the budget is kept.
    const long = { url: "text:1", title: "Notes", content: "x".repeat(SETUP_LIMITS.pageChars + 500) };
    const tight = selectPages([pages[2]!, long, pages[1]!], SETUP_LIMITS.pageChars + 40);
    expect(tight.map((p) => p.title)).toEqual(["Notes", "Hours"]);
    expect(tight[0]!.content).toHaveLength(SETUP_LIMITS.pageChars);
    expect(tight[1]!.content).toHaveLength(40);
  });

  it("puts the pages and languages in the request", () => {
    const request = buildSetupRequest({
      businessName: "Café",
      industry: "Café & bakery",
      languages: ["en", "fr"],
      defaultLanguage: "en",
      pages: [{ url: "text:abc", title: 'Our "notes" <b>', content: "Open daily." }, pages[1]!],
    });
    const message = request.messages[0]!.content as string;
    expect(message).toContain("en (English), fr (French)");
    expect(message).toContain('<page title="Our notes b">\nOpen daily.');
    expect(message).toContain('<page title="Hours" url="https://cafe.example/hours">');
  });

  it("finds the JSON object in a reply", () => {
    expect(extractJson('```json\n{"phone": "1"}\n```')).toEqual({ phone: "1" });
    expect(extractJson('Here you go: {"a": {"b": 2}} Hope that helps!')).toEqual({ a: { b: 2 } });
    expect(extractJson("I can't do that.")).toBeNull();
    expect(extractJson('{"a": ')).toBeNull();
    expect(extractJson("[1, 2]")).toBeNull();
  });

  it("keeps what the pages support, in the shapes the assistant accepts", () => {
    const suggestion = readSuggestion(goodReply, { pages, languages: ["en", "fr"] });
    expect(suggestion.profile).toEqual({
      businessName: "Northern Lights Café",
      phone: "807-555-0123",
      email: "hello@northernlights.example",
      address: "12 Water Street, Thunder Bay",
      hours: { ...hours, mon: [{ open: "07:00", close: "16:00" }] },
    });
    expect(suggestion.evidence).toEqual({ address: goodReply.addressQuote, hours: goodReply.hoursQuote });
    // Only the assistant's languages; repeated questions once.
    expect(suggestion.greeting).toEqual({ en: goodReply.greeting.en });
    expect(suggestion.quickReplies).toEqual({
      en: ["What are your hours?", "Where are you?"],
      fr: ["Vos heures ?"],
    });
    expect(suggestion.missing).toEqual(goodReply.missing);
  });

  it("drops details that aren't in the pages", () => {
    const suggestion = readSuggestion(
      {
        businessName: "Aurora Bistro",
        phone: "807-555-9999",
        email: "owner@elsewhere.example",
        address: "99 Main Street",
        addressQuote: "Visit us at 99 Main Street",
        hours,
        hoursQuote: "Open every day from 7 to 4",
        greeting: "Welcome!",
        quickReplies: { en: "What are your hours?" },
        missing: "none",
      },
      { pages, languages: ["en"] },
    );
    expect(suggestion).toEqual({ profile: {}, evidence: {}, greeting: {}, quickReplies: {}, missing: [] });

    // A quote the model stitched together from two places still counts; unusable times don't.
    const stitched = readSuggestion(
      {
        hours: { mon: [{ open: "7am", close: "16:00" }], sat: [{ open: "08:00", close: "14:00" }] },
        hoursQuote: "Monday to Friday from 7 am to 4 pm … Closed Sundays.",
      },
      { pages, languages: ["en"] },
    );
    expect(stitched.profile.hours).toEqual({
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [{ open: "08:00", close: "14:00" }],
      sun: [],
    });
  });

  it("picks out contact details by pattern when there is no model", () => {
    expect(basicSuggestion(pages)).toEqual({
      phone: "(807) 555-0123",
      email: "hello@northernlights.example",
    });
    expect(basicSuggestion([pages[2]!])).toEqual({});
  });
});

// ---- Runs against the database ---------------------------------------------------------------

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;
let owner: DbHandle;
let app: DbHandle;
let tenantId: string;
let botId: string;
let emptyBotId: string;

/** A model that replies with the next scripted text. */
class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  requests: ChatRequest[] = [];
  constructor(private readonly replies: (string | Error)[]) {}
  supportsImages() {
    return false;
  }
  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push(request);
    const reply = this.replies[this.requests.length - 1] ?? "";
    if (reply instanceof Error) throw reply;
    yield { type: "text", text: reply };
    yield {
      type: "done",
      model,
      stopReason: "end",
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

const offline: ModelRoute[] = [{ provider: "offline", model: "knowledge" }];
const gatewayFor = (provider?: ScriptedProvider) =>
  new LLMGateway({
    providers: [new OfflineProvider(), ...(provider ? [provider] : [])],
    routes: {
      chat: offline,
      aux: [{ provider: "offline", model: "echo" }],
      ...(provider ? { agent: [{ provider: "scripted", model: "s1" }] } : {}),
    },
  });

async function startRun(bot = botId) {
  const [run] = await withTenant(app.db, tenantId, (tx) =>
    tx.insert(setupRuns).values({ tenantId, botId: bot }).returning(),
  );
  return run!.id;
}
const getRun = async (id: string) =>
  (await withTenant(app.db, tenantId, (tx) => tx.select().from(setupRuns).where(eq(setupRuns.id, id))))[0]!;

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 4 });
  const [tenant] = await owner.db
    .insert(tenants)
    .values({ name: "Northern Lights Café", slug: `setup-${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  tenantId = tenant!.id;
  const [bot, empty] = await owner.db
    .insert(bots)
    .values([
      { tenantId, name: "Café assistant", pack: "cafe-bakery", languages: ["en", "fr"] },
      { tenantId, name: "Empty", pack: "generic" },
    ])
    .returning();
  botId = bot!.id;
  emptyBotId = empty!.id;
  const [website, notes] = await owner.db
    .insert(knowledgeSources)
    .values([
      {
        tenantId,
        botId,
        type: "website",
        title: "cafe.example",
        url: "https://cafe.example/menu",
        status: "ready",
      },
      { tenantId, botId, type: "text", title: "Notes", status: "ready" },
    ])
    .returning();
  await withTenant(app.db, tenantId, async (tx) => {
    await indexDocuments(tx, {
      tenantId,
      botId,
      sourceId: website!.id,
      removeMissing: true,
      docs: pages.slice(0, 2).map((page) => ({
        url: page.url,
        title: page.title,
        language: "en",
        sections: [{ heading: page.title, text: page.content }],
        text: page.content,
      })),
    });
    await indexDocuments(tx, {
      tenantId,
      botId,
      sourceId: notes!.id,
      removeMissing: true,
      docs: [
        {
          url: `text:${notes!.id}`,
          title: "Notes",
          language: "en",
          sections: [{ heading: null, text: "We repainted the patio." }],
          text: "We repainted the patio.",
        },
      ],
    });
  });
});

afterAll(async () => {
  if (tenantId) await owner?.db.delete(tenants).where(eq(tenants.id, tenantId));
  await app?.close();
  await owner?.close();
});

describe("setup assistant: runs", () => {
  it("stores a suggestion for the owner to review, with what it cost", async () => {
    const provider = new ScriptedProvider([JSON.stringify(goodReply)]);
    const runId = await startRun();
    await runSetup({ db: app.db, gateway: gatewayFor(provider) }, tenantId, runId);

    const run = await getRun(runId);
    expect(run).toMatchObject({ status: "ready", error: null, model: "s1" });
    expect(run.suggestion).toMatchObject({
      profile: { phone: "807-555-0123", websiteUrl: "https://cafe.example", hours: { sun: [] } },
      greeting: { en: goodReply.greeting.en },
      missing: goodReply.missing,
      pagesRead: 3,
      pagesTotal: 3,
    });
    expect(run.suggestion!.basic).toBeUndefined();

    // The model was given the business, its languages (default first) and its pages.
    const message = provider.requests[0]!.messages[0]!.content as string;
    expect(message).toContain("Name on the account: Northern Lights Café");
    expect(message).toContain("Industry: Café & bakery");
    expect(message).toContain("en (English), fr (French)");
    expect(message).toContain("Closed Sundays.");

    const usage = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(usageEvents).where(eq(usageEvents.botId, botId)),
    );
    expect(usage.filter((u) => u.kind === "llm.agent")).toMatchObject([
      { quantity: 120, metadata: { task: "setup", model: "s1" } },
    ]);

    // Nothing was changed: the assistant's settings wait for the owner.
    const [bot] = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(bots).where(eq(bots.id, botId)),
    );
    expect(bot!.settings.greeting).toBeUndefined();

    // A finished run isn't run again.
    await runSetup({ db: app.db, gateway: gatewayFor(provider) }, tenantId, runId);
    expect(provider.requests).toHaveLength(1);
  });

  it("asks once more when the reply isn't JSON, then gives up", async () => {
    const recovers = new ScriptedProvider(["Sure! Let me think about that.", JSON.stringify(goodReply)]);
    const first = await startRun();
    await runSetup({ db: app.db, gateway: gatewayFor(recovers) }, tenantId, first);
    expect(await getRun(first)).toMatchObject({ status: "ready" });
    expect(recovers.requests).toHaveLength(2);

    const never = new ScriptedProvider(["No.", "Still no."]);
    const second = await startRun();
    await runSetup({ db: app.db, gateway: gatewayFor(never) }, tenantId, second);
    expect(await getRun(second)).toMatchObject({
      status: "failed",
      error: SETUP_ERRORS.unreadable,
      suggestion: null,
    });
  });

  it("records why a run failed instead of throwing", async () => {
    const down = new ScriptedProvider([new Error("connection refused")]);
    const first = await startRun();
    await runSetup({ db: app.db, gateway: gatewayFor(down) }, tenantId, first);
    expect(await getRun(first)).toMatchObject({ status: "failed", error: SETUP_ERRORS.unavailable });

    const second = await startRun(emptyBotId);
    await runSetup({ db: app.db, gateway: gatewayFor(new ScriptedProvider([])) }, tenantId, second);
    expect(await getRun(second)).toMatchObject({ status: "failed", error: SETUP_ERRORS.noInformation });
  });

  it("looks up contact details only when no model is configured", async () => {
    const runId = await startRun();
    await runSetup({ db: app.db, gateway: gatewayFor() }, tenantId, runId);
    const run = await getRun(runId);
    expect(run).toMatchObject({ status: "ready", model: null, costMicros: 0 });
    expect(run.suggestion).toEqual({
      profile: {
        phone: "(807) 555-0123",
        email: "hello@northernlights.example",
        websiteUrl: "https://cafe.example",
      },
      evidence: {},
      greeting: {},
      quickReplies: {},
      missing: [],
      pagesRead: 3,
      pagesTotal: 3,
      basic: true,
    });
  });
});
