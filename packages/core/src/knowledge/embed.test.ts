import {
  assets,
  bots,
  chunks,
  createDb,
  type DbHandle,
  jobs,
  knowledgeImages,
  knowledgeSources,
  qaPairs,
  runMigrations,
  tenants,
  usageEvents,
  withTenant,
} from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  type EmbeddingProvider,
  type EmbedResult,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
  QueryEmbedder,
} from "@traiblazer/llm";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChatStreamEvent, runChat } from "../chat/engine.js";
import { retrievePassages, retrievePhotos } from "../chat/retrieval.js";
import { JOB_TYPES } from "../jobs.js";
import { botsNeedingVectors, embedChunks, enqueueEmbedding, warmQuestions } from "./embed.js";
import { type IncomingDocument, indexDocuments, tsvectorSql } from "./index-documents.js";
import { syncSource } from "./sync.js";

const ownerUrl = process.env.TEST_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_APP_URL as string;

/** Words that mean the same thing share a dimension, like a real model would place them close. */
const CONCEPTS: string[][] = [
  ["senior", "seniors", "retiree", "retirees", "elderly", "aînés"],
  ["pie", "pies", "tart", "tarte"],
  ["open", "hours", "ouvert", "horaires"],
  ["parking", "park", "stationnement"],
];
const DIMS = 16;

/** A tiny deterministic stand-in for an embedding model. Counts its calls and texts. */
class ConceptEmbeddings implements EmbeddingProvider {
  readonly model = "concepts@16";
  readonly maxDistance = 0.7;
  readonly pricePerMillionTokens = 0.02;
  calls = 0;
  texts: string[] = [];
  fail = false;
  delayMs = 0;

  async embed(texts: string[]): Promise<EmbedResult> {
    this.calls++;
    this.texts.push(...texts);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw new Error("provider down");
    return { vectors: texts.map(vectorOf), tokens: texts.length * 10 };
  }
}

function vectorOf(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}]+/gu) ?? []) {
    const concept = CONCEPTS.findIndex((words) => words.includes(word));
    if (concept >= 0) v[concept]! += 1;
  }
  // Never all zero: a weak "everything else" direction.
  v[DIMS - 1] = 0.05;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

const doc = (sections: [string, string][]): IncomingDocument => ({
  url: "text:menu",
  title: "Menu",
  language: "en",
  sections: sections.map(([heading, text]) => ({ heading, text })),
  text: sections.map(([h, t]) => `${h}\n${t}`).join("\n\n"),
});

/** Long enough (200+ characters) to stay chunks of their own. */
const filler = " We are a small family bakery on the waterfront and have been baking since 1987.".repeat(3);
const SECTIONS: [string, string][] = [
  ["Discounts", `Seniors get 10% off every Tuesday.${filler}`],
  ["Baking", `Our blueberry pie is baked fresh every morning.${filler}`],
  ["Visiting", `Free parking behind the building.${filler}`],
];

let owner: DbHandle;
let app: DbHandle;
let tenantId: string;
let botId: string;
let sourceId: string;

const pendingChunks = () =>
  withTenant(app.db, tenantId, (tx) =>
    tx
      .select({ id: chunks.id })
      .from(chunks)
      .where(and(eq(chunks.botId, botId), isNull(chunks.embedding))),
  );

beforeAll(async () => {
  await runMigrations(ownerUrl);
  owner = createDb(ownerUrl, { max: 2 });
  app = createDb(appUrl, { max: 4 });
  const [t] = await owner.db
    .insert(tenants)
    .values({ name: "Bakery", slug: `bakery-${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  tenantId = t!.id;
  const [b] = await owner.db
    .insert(bots)
    .values({ tenantId, name: "Bakery bot", pack: "cafe-bakery", status: "active" })
    .returning();
  botId = b!.id;
  const [s] = await owner.db
    .insert(knowledgeSources)
    .values({ tenantId, botId, type: "text", title: "Menu", content: "x" })
    .returning();
  sourceId = s!.id;
});

afterAll(async () => {
  await owner?.db.delete(tenants).where(eq(tenants.id, tenantId));
  await app?.close();
  await owner?.close();
});

describe("embedding the business's information", () => {
  const embeddings = new ConceptEmbeddings();

  it("indexes without calling the provider; the job adds the vectors and records the tokens", async () => {
    const result = await withTenant(app.db, tenantId, (tx) =>
      indexDocuments(tx, { tenantId, botId, sourceId, docs: [doc(SECTIONS)], removeMissing: true }),
    );
    expect(result).toMatchObject({ chunks: 3, unembedded: 3 });
    expect(embeddings.calls).toBe(0);

    expect(await embedChunks({ db: app.db, embeddings }, tenantId, botId)).toEqual({
      embedded: 3,
      more: false,
    });
    expect(embeddings.calls).toBe(1);
    expect(await pendingChunks()).toEqual([]);
    const [row] = await withTenant(app.db, tenantId, (tx) =>
      tx.select().from(chunks).where(eq(chunks.botId, botId)).limit(1),
    );
    expect(row!.embeddingModel).toBe("concepts@16");
    expect(row!.embedding).toHaveLength(DIMS);
    expect(row!.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const usage = await owner.db
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.botId, botId), eq(usageEvents.kind, "embedding")));
    expect(usage).toMatchObject([{ quantity: 30, metadata: { task: "documents", chunks: 3 } }]);
  });

  it("re-embeds only the text that changed", async () => {
    embeddings.texts = [];
    const changed = SECTIONS.map(([h, t]): [string, string] =>
      h === "Baking" ? [h, `Our blueberry tart is baked fresh every morning.${filler}`] : [h, t],
    );
    const result = await withTenant(app.db, tenantId, (tx) =>
      indexDocuments(tx, { tenantId, botId, sourceId, docs: [doc(changed)], removeMissing: true }),
    );
    expect(result).toMatchObject({ chunks: 3, unembedded: 1 });
    await embedChunks({ db: app.db, embeddings }, tenantId, botId);
    expect(embeddings.texts).toEqual([`Baking\nOur blueberry tart is baked fresh every morning.${filler}`]);
  });

  it("moves every chunk to a new model (backfill)", async () => {
    const next = Object.assign(new ConceptEmbeddings(), { model: "concepts@16-v2" });
    expect((await embedChunks({ db: app.db, embeddings: next }, tenantId, botId)).embedded).toBe(3);
    const models = await withTenant(app.db, tenantId, (tx) =>
      tx.selectDistinct({ model: chunks.embeddingModel }).from(chunks).where(eq(chunks.botId, botId)),
    );
    expect(models).toEqual([{ model: "concepts@16-v2" }]);
    // Back to the first model for the tests below.
    await embedChunks({ db: app.db, embeddings }, tenantId, botId);
  });

  it("queues one job per assistant, and a sync queues it only when embeddings are on", async () => {
    await enqueueEmbedding(app.db, tenantId, botId);
    await enqueueEmbedding(app.db, tenantId, botId);
    const queued = () =>
      owner.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, JOB_TYPES.embedChunks)));
    expect(await queued()).toHaveLength(1);
    await owner.db.delete(jobs).where(eq(jobs.tenantId, tenantId));

    await owner.db
      .update(knowledgeSources)
      .set({ content: "Opening hours: we are open from 7 to 4.\n\nWe sell gift cards." })
      .where(eq(knowledgeSources.id, sourceId));
    await syncSource({ db: app.db }, tenantId, sourceId);
    expect(await queued()).toHaveLength(0);
    await owner.db
      .update(knowledgeSources)
      .set({ content: "Opening hours: we are open from 7 to 5.\n\nWe sell gift cards." })
      .where(eq(knowledgeSources.id, sourceId));
    await syncSource({ db: app.db, embeddings }, tenantId, sourceId);
    expect(await queued()).toMatchObject([{ payload: { botId } }]);
    await owner.db.delete(jobs).where(eq(jobs.tenantId, tenantId));

    // Back to the menu for the search tests.
    await withTenant(app.db, tenantId, (tx) =>
      indexDocuments(tx, { tenantId, botId, sourceId, docs: [doc(SECTIONS)], removeMissing: true }),
    );
    await embedChunks({ db: app.db, embeddings }, tenantId, botId);
  });
});

describe("searching by meaning", () => {
  const embeddings = new ConceptEmbeddings();
  const queryVector = async (text: string) => (await new QueryEmbedder(embeddings).embed(text))!;
  const search = async (question: string, withVector: boolean) =>
    withTenant(app.db, tenantId, async (tx) =>
      retrievePassages(tx, {
        botId,
        queries: [question],
        embedding: withVector ? await queryVector(question) : null,
      }),
    );

  it("finds text that shares no word with the question", async () => {
    const question = "Anything cheaper when you're retirees?";
    expect((await search(question, false)).map((p) => p.heading)).not.toContain("Discounts");
    expect((await search(question, true))[0]?.heading).toBe("Discounts");
  });

  it("leaves out text that is far from the question", async () => {
    const found = await search("Do you sell bicycles?", true);
    expect(found).toEqual([]);
  });
});

/** A chat model that keeps what it was given, to see which information reached it. */
class Recorder implements LLMProvider {
  readonly id = "recorder";
  last: ChatRequest | null = null;
  supportsImages() {
    return false;
  }
  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    this.last = request;
    yield { type: "text", text: "Noted." };
    yield {
      type: "done",
      model,
      stopReason: "end",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

describe("answering when the embedding service is slow or down", () => {
  const recorder = new Recorder();
  const gateway = new LLMGateway({
    providers: [new OfflineProvider(), recorder],
    routes: { chat: [{ provider: "recorder", model: "r1" }], aux: [{ provider: "offline", model: "echo" }] },
  });
  /** The business information the chat model was given for the last answer. */
  const knowledge = () => recorder.last!.system.map((b) => b.text).join("\n");
  const ask = async (embedder: QueryEmbedder, message: string, waitMs = 150) => {
    const events: ChatStreamEvent[] = [];
    const logs: string[] = [];
    const started = Date.now();
    for await (const event of runChat(
      { db: app.db, gateway, embeddings: embedder, embeddingWaitMs: waitMs, log: (msg) => logs.push(msg) },
      { tenantId, botId, visitorId: `v-${crypto.randomUUID()}`, channel: "hosted", message },
    )) {
      events.push(event);
    }
    const reply = events.map((e) => (e.type === "text" ? e.text : "")).join("");
    return { events, logs, reply, ms: Date.now() - started };
  };

  it("answers from keyword search when the provider fails", async () => {
    const down = Object.assign(new ConceptEmbeddings(), { fail: true });
    const logs: string[] = [];
    const embedder = new QueryEmbedder(down, { log: (msg) => logs.push(msg) });
    const { events, reply } = await ask(embedder, "Is your blueberry pie fresh?");
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(reply).toBe("Noted.");
    expect(knowledge()).toContain("blueberry pie");
    expect(logs).toContain("embedding failed");
  });

  it("doesn't wait for a slow provider", async () => {
    const slow = Object.assign(new ConceptEmbeddings(), { delayMs: 3000 });
    const { events, logs, ms } = await ask(new QueryEmbedder(slow), "Is your blueberry pie fresh?", 100);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(logs).toContain("embedding late");
    expect(ms).toBeLessThan(2500);
  });

  it("uses the vector when it's in time, and records the tokens", async () => {
    const embedder = new QueryEmbedder(new ConceptEmbeddings());
    await ask(embedder, "Anything cheaper for retirees?", 1000);
    expect(knowledge()).toContain("Seniors get 10% off");
    const usage = await owner.db
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.botId, botId), eq(usageEvents.kind, "embedding")));
    expect(usage.some((u) => (u.metadata as { task?: string }).task === "questions")).toBe(true);
  });
});

describe("the owner's answers and photos", () => {
  const embeddings = new ConceptEmbeddings();
  const embedder = new QueryEmbedder(embeddings);
  const HOURS = "Êtes-vous ouvert le dimanche ?";
  const PARK = "Where can I park?";
  let pairId: string;

  const answers = async (question: string, withVector: boolean) =>
    withTenant(app.db, tenantId, async (tx) =>
      retrievePassages(tx, {
        botId,
        queries: [question],
        embedding: withVector ? await embedder.embed(question) : null,
      }),
    ).then((found) => found.filter((p) => p.kind === "qa").map((p) => p.title));
  const photos = async (question: string, withVector: boolean) =>
    withTenant(app.db, tenantId, async (tx) =>
      retrievePhotos(tx, {
        botId,
        queries: [question],
        embedding: withVector ? await embedder.embed(question) : null,
      }),
    ).then((found) => found.map((p) => p.title));
  const usageTasks = async () =>
    (
      await owner.db
        .select()
        .from(usageEvents)
        .where(and(eq(usageEvents.botId, botId), eq(usageEvents.kind, "embedding")))
    ).map((u) => (u.metadata as { task?: string }).task);

  beforeAll(async () => {
    // Chunks on this model already, so the counts below are the answers and photos alone.
    await embedChunks({ db: app.db, embeddings }, tenantId, botId);
    await withTenant(app.db, tenantId, async (tx) => {
      const question = "What are your hours?";
      const answer = "7 am to 6 pm, every day.";
      const [pair] = await tx
        .insert(qaPairs)
        .values({
          tenantId,
          botId,
          question,
          answer,
          tsv: tsvectorSql(`${question}\n${answer}`, "en") as unknown as string,
        })
        .returning({ id: qaPairs.id });
      pairId = pair!.id;
      const [asset] = await tx
        .insert(assets)
        .values({
          tenantId,
          kind: "knowledge_image",
          contentType: "image/png",
          bytes: Buffer.from([1]),
          sizeBytes: 1,
          sha256: "0".repeat(64),
        })
        .returning({ id: assets.id });
      const title = "Stationnement";
      const description = "Behind the bakery, next to the river.";
      await tx.insert(knowledgeImages).values({
        tenantId,
        botId,
        assetId: asset!.id,
        title,
        description,
        tsv: tsvectorSql(`${title}\n${description}`, "fr") as unknown as string,
      });
    });
  });

  it("finds them by meaning once the job has embedded them", async () => {
    expect(await answers(HOURS, true)).toEqual([]);
    expect(await photos(PARK, true)).toEqual([]);
    expect(await botsNeedingVectors(owner.db, embeddings.model)).toContainEqual({ tenantId, botId });

    expect(await embedChunks({ db: app.db, embeddings }, tenantId, botId)).toEqual({
      embedded: 2,
      more: false,
    });
    expect(await usageTasks()).toEqual(expect.arrayContaining(["answers", "photos"]));
    expect(await botsNeedingVectors(owner.db, embeddings.model)).not.toContainEqual({ tenantId, botId });

    expect(await answers(HOURS, false)).toEqual([]);
    expect(await answers(HOURS, true)).toEqual(["What are your hours?"]);
    expect(await photos(PARK, false)).toEqual([]);
    expect(await photos(PARK, true)).toEqual(["Stationnement"]);
    // A shared filler word ("your", "the") isn't a match.
    expect(await answers("Are your croissants made with butter?", false)).toEqual([]);
    expect(await photos("Is the oven on?", false)).toEqual([]);
    // Far from both.
    expect(await answers("Do you sell bicycles?", true)).toEqual([]);
    expect(await photos("Do you sell bicycles?", true)).toEqual([]);
  });

  it("embeds an answer again when its text is edited, and only then", async () => {
    embeddings.texts = [];
    expect((await embedChunks({ db: app.db, embeddings }, tenantId, botId)).embedded).toBe(0);
    await withTenant(app.db, tenantId, (tx) =>
      tx.update(qaPairs).set({ answer: "7 am to 5 pm, closed Mondays." }).where(eq(qaPairs.id, pairId)),
    );
    expect((await embedChunks({ db: app.db, embeddings }, tenantId, botId)).embedded).toBe(1);
    expect(embeddings.texts).toEqual(["What are your hours?\n7 am to 5 pm, closed Mondays."]);
  });

  it("embeds suggested questions ahead of the first tap", async () => {
    const provider = new ConceptEmbeddings();
    const warm = new QueryEmbedder(provider);
    await warmQuestions({ db: app.db, embeddings: warm }, tenantId, botId, [
      "Do you have parking?",
      "Do you have parking? ",
      "What are your hours?",
    ]);
    expect(provider.calls).toBe(2);
    expect(await usageTasks()).toContain("quick-replies");
    expect(await warm.embed("Do you have parking?")).toMatchObject({ tokens: 0 });
    expect(provider.calls).toBe(2);
  });
});
