import { describe, expect, it } from "vitest";
import { createEmbeddingsFromEnv } from "./config.js";
import { LocalEmbeddings, type LocalEncoder } from "./local-embeddings.js";

/** A stand-in for the model: remembers what it was given and how many runs overlapped. */
function fakeModel() {
  const state = { loads: 0, batches: [] as string[][], running: 0, most: 0, failLoads: 0 };
  const load = async (): Promise<LocalEncoder> => {
    state.loads++;
    if (state.failLoads-- > 0) throw new Error("download failed");
    return async (texts) => {
      state.most = Math.max(state.most, ++state.running);
      await new Promise((r) => setTimeout(r, 5));
      state.running--;
      state.batches.push(texts);
      return texts.map(() => [3, 4, 0]);
    };
  };
  return { state, load };
}

describe("LocalEmbeddings", () => {
  it("loads the model once, names it, and adds the e5 prefixes", async () => {
    const { state, load } = fakeModel();
    const local = new LocalEmbeddings({ model: "Xenova/multilingual-e5-small", load });
    expect(local.model).toBe("local/Xenova/multilingual-e5-small");
    expect(local.pricePerMillionTokens).toBe(0);
    expect(state.loads).toBe(0);
    const docs = await local.embed(["Open daily"], "document");
    expect(docs.vectors).toEqual([[0.6, 0.8, 0]]);
    expect(docs.tokens).toBeGreaterThan(0);
    await local.embed(["open today?"], "query");
    expect(state.loads).toBe(1);
    expect(state.batches).toEqual([["passage: Open daily"], ["query: open today?"]]);
  });

  it("uses the prefixes it is given, and none for other models", async () => {
    const plain = fakeModel();
    await new LocalEmbeddings({ model: "acme/minilm", load: plain.load }).embed(["a"], "query");
    const own = fakeModel();
    await new LocalEmbeddings({ model: "acme/minilm", queryPrefix: "Q: ", load: own.load }).embed(
      ["a"],
      "query",
    );
    expect([plain.state.batches, own.state.batches]).toEqual([[["a"]], [["Q: a"]]]);
  });

  it("runs one batch at a time, in batches of the size set", async () => {
    const { state, load } = fakeModel();
    const local = new LocalEmbeddings({ model: "m", batchSize: 2, load });
    const [a, b] = await Promise.all([local.embed(["1", "2", "3"], "document"), local.embed(["4"], "query")]);
    expect(a.vectors).toHaveLength(3);
    expect(b.vectors).toHaveLength(1);
    expect(state.most).toBe(1);
    expect(state.batches.map((batch) => batch.length).sort()).toEqual([1, 1, 2]);
  });

  it("cuts vectors when a size is set", async () => {
    const { load } = fakeModel();
    const local = new LocalEmbeddings({ model: "m", dimensions: 2, load });
    expect(local.model).toBe("local/m@2");
    expect((await local.embed(["a"], "query")).vectors).toEqual([[0.6, 0.8]]);
  });

  it("tries to load again after a failure, and skips work nobody waits for", async () => {
    const { state, load } = fakeModel();
    state.failLoads = 1;
    const local = new LocalEmbeddings({ model: "m", load });
    await expect(local.embed(["a"], "query")).rejects.toThrow("download failed");
    expect((await local.embed(["a"], "query")).vectors).toHaveLength(1);
    expect(state.loads).toBe(2);

    const gone = AbortSignal.abort();
    await expect(local.embed(["b"], "query", { signal: gone })).rejects.toThrow();
    expect(state.batches).toEqual([["a"]]);
  });

  it("is chosen with EMBEDDINGS_PROVIDER=local, at the model's own size", () => {
    const local = createEmbeddingsFromEnv({
      EMBEDDINGS_PROVIDER: "local",
      EMBEDDINGS_MODEL: "Xenova/multilingual-e5-small",
      EMBEDDINGS_MAX_DISTANCE: "0.2",
    });
    expect(local).toBeInstanceOf(LocalEmbeddings);
    expect(local).toMatchObject({ model: "local/Xenova/multilingual-e5-small", maxDistance: 0.2 });
    expect(createEmbeddingsFromEnv({ EMBEDDINGS_PROVIDER: "local" })).toBeNull();
  });
});
