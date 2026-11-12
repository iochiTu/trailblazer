import { describe, expect, it } from "vitest";
import {
  type EmbeddingProvider,
  type EmbedResult,
  fitDimensions,
  OpenAICompatibleEmbeddings,
  QueryEmbedder,
  type VectorCache,
  withDeadline,
} from "./embeddings.js";

/** A fake `/embeddings` endpoint: answers with the queued statuses first, then vectors of 4 numbers. */
function endpoint(statuses: number[] = []) {
  const requests: Record<string, unknown>[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { input: string[] };
    requests.push(body);
    const status = statuses.shift() ?? 200;
    if (status !== 200) return new Response("busy", { status });
    return Response.json({
      data: body.input.map((_, index) => ({ index, embedding: [3, 4, 0, 0] })).reverse(),
      usage: { total_tokens: body.input.length * 7 },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const provider = (fetch: typeof globalThis.fetch, extra: object = {}) =>
  new OpenAICompatibleEmbeddings({
    baseURL: "https://embed.test/v1/",
    apiKey: "k",
    model: "m",
    fetch,
    ...extra,
  });

describe("fitDimensions", () => {
  it("cuts and scales the vector back to length 1", () => {
    expect(fitDimensions([3, 4, 12], 2)).toEqual([0.6, 0.8]);
    expect(fitDimensions([0, 2], null)).toEqual([0, 1]);
  });
});

describe("OpenAI-compatible embeddings", () => {
  it("names the model with its size, asks for it and puts the prefixes in", async () => {
    const api = endpoint();
    const embeddings = provider(api.fetch, {
      dimensions: 2,
      dimensionsParam: "output_dimension",
      sendInputType: true,
      queryPrefix: "query: ",
      documentPrefix: "passage: ",
    });
    expect(embeddings.model).toBe("m@2");
    const result = await embeddings.embed(["a", "b"], "document");
    expect(result).toEqual({
      vectors: [
        [0.6, 0.8],
        [0.6, 0.8],
      ],
      tokens: 14,
    });
    expect(api.requests[0]).toEqual({
      model: "m",
      input: ["passage: a", "passage: b"],
      input_type: "document",
      output_dimension: 2,
    });
    await embeddings.embed(["c"], "query");
    expect(api.requests[1]).toMatchObject({ input: ["query: c"], input_type: "query" });
  });

  it("sends documents in batches", async () => {
    const api = endpoint();
    const result = await provider(api.fetch, { batchSize: 2 }).embed(["a", "b", "c"], "document");
    expect(api.requests.map((r) => (r.input as string[]).length)).toEqual([2, 1]);
    expect(result.vectors).toHaveLength(3);
  });

  it("tries documents again after a rate limit or server error, never queries", async () => {
    const docs = endpoint([429, 503]);
    expect((await provider(docs.fetch).embed(["a"], "document")).vectors).toHaveLength(1);
    expect(docs.requests).toHaveLength(3);

    const query = endpoint([503]);
    await expect(provider(query.fetch).embed(["a"], "query")).rejects.toThrow(/503/);
    expect(query.requests).toHaveLength(1);

    const refused = endpoint([400]);
    await expect(provider(refused.fetch).embed(["a"], "document")).rejects.toThrow(/400/);
    expect(refused.requests).toHaveLength(1);
  });
});

class Fake implements EmbeddingProvider {
  readonly model = "fake@2";
  readonly maxDistance = 0.7;
  readonly pricePerMillionTokens = 0.02;
  calls = 0;
  fail = false;
  delayMs = 0;
  async embed(texts: string[]): Promise<EmbedResult> {
    this.calls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw new Error("down");
    return { vectors: texts.map(() => [1, 0]), tokens: 5 };
  }
}

class MapCache implements VectorCache {
  readonly map = new Map<string, number[]>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, vector: number[]) {
    this.map.set(key, vector);
  }
}

describe("QueryEmbedder", () => {
  it("asks once for the same question, however it is spaced, and remembers it", async () => {
    const fake = new Fake();
    const embedder = new QueryEmbedder(fake);
    const [a, b] = await Promise.all([
      embedder.embed("Open on Sunday?"),
      embedder.embed("open  on sunday? "),
    ]);
    expect(fake.calls).toBe(1);
    expect(a).toMatchObject({ vector: [1, 0], model: "fake@2", maxDistance: 0.7, tokens: 5, costMicros: 0 });
    expect(b).toEqual(a);
    expect(await embedder.embed("Open on Sunday?")).toMatchObject({ tokens: 0 });
    expect(fake.calls).toBe(1);
  });

  it("shares vectors through the cache, keyed by a hash only", async () => {
    const cache = new MapCache();
    await new QueryEmbedder(new Fake(), { cache }).embed("Do you deliver?");
    const [key] = cache.map.keys();
    expect(key).toMatch(/^emb:[0-9a-f]{64}$/);
    const other = new Fake();
    expect(await new QueryEmbedder(other, { cache }).embed("Do you deliver?")).toMatchObject({ tokens: 0 });
    expect(other.calls).toBe(0);
  });

  it("doesn't wait for a cache that hangs", async () => {
    const fake = new Fake();
    const hanging: VectorCache = { get: () => new Promise(() => {}), set: async () => {} };
    const embedder = new QueryEmbedder(fake, { cache: hanging, cacheWaitMs: 10 });
    expect(await embedder.embed("Open today?")).toMatchObject({ vector: [1, 0], tokens: 5 });
  });

  it("never throws, and stops asking for a while after failures in a row", async () => {
    let now = 0;
    const fake = Object.assign(new Fake(), { fail: true });
    const logs: string[] = [];
    const embedder = new QueryEmbedder(fake, {
      failuresToOpen: 2,
      openMs: 1000,
      now: () => now,
      log: (msg) => logs.push(msg),
    });
    expect(await embedder.embed("one")).toBeNull();
    expect(await embedder.embed("two")).toBeNull();
    expect(await embedder.embed("three")).toBeNull();
    expect(fake.calls).toBe(2);
    expect(logs).toEqual(["embedding failed", "embedding failed"]);
    now = 1001;
    fake.fail = false;
    expect(await embedder.embed("four")).not.toBeNull();
  });

  it("gives up on a provider that takes too long", async () => {
    const hanging: EmbeddingProvider = {
      model: "slow@2",
      maxDistance: 0.7,
      pricePerMillionTokens: 0.02,
      embed: (_texts, _kind, options) =>
        new Promise<EmbedResult>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    expect(await new QueryEmbedder(hanging, { timeoutMs: 20 }).embed("hello")).toBeNull();
  });
});

describe("withDeadline", () => {
  it("gives the value when it comes in time, null otherwise", async () => {
    let late = false;
    expect(await withDeadline(Promise.resolve(1), 50)).toBe(1);
    const slow = new Promise<number>((r) => setTimeout(() => r(2), 100));
    expect(await withDeadline(slow, 10, () => (late = true))).toBeNull();
    expect(late).toBe(true);
    expect(await withDeadline(Promise.reject(new Error("x")), 10)).toBeNull();
  });
});
