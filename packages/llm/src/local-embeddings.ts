import { type EmbeddingProvider, type EmbedResult, fitDimensions } from "./embeddings.js";

/** Turns texts into one vector each (mean-pooled, length 1). What the loaded model looks like to us. */
export type LocalEncoder = (texts: string[]) => Promise<number[][]>;

export interface LocalEmbeddingsOptions {
  /** Hugging Face model id with ONNX weights, e.g. "Xenova/multilingual-e5-small". */
  model: string;
  /** Weights to load: "q8" (8-bit, smallest and fastest on a CPU), "fp16", "fp32". Default "q8". */
  dtype?: string;
  /** Cut vectors to this size (only for models trained for it); null keeps the model's own size. */
  dimensions?: number | null;
  /** Text put before each query / document (e5 models: "query: " and "passage: "). */
  queryPrefix?: string;
  documentPrefix?: string;
  /** Texts per run of the model (default 16): bounds the memory one run needs. */
  batchSize?: number;
  maxDistance?: number;
  /** Where downloaded models are kept (default: the library's cache folder). */
  cacheDir?: string;
  /** Never download: the model must already be in `cacheDir` (servers without internet access). */
  offline?: boolean;
  /** Loads the model; replaced in tests. */
  load?: (options: LocalEmbeddingsOptions) => Promise<LocalEncoder>;
}

/** e5-style models are trained with these in front of every text. */
const prefixesFor = (model: string) =>
  /(^|\/)(multilingual-)?e5-/i.test(model) ? { query: "query: ", document: "passage: " } : null;

/**
 * An embedding model run inside this process (ONNX, on the CPU): no cost per call, and neither the
 * business's text nor visitors' questions leave the server (docs/EMBEDDINGS.md §4.1). The model is
 * loaded on first use, or ahead of time with `warmUp()`; one run at a time, so a burst of questions
 * queues instead of multiplying memory.
 */
export class LocalEmbeddings implements EmbeddingProvider {
  readonly model: string;
  readonly maxDistance: number;
  readonly pricePerMillionTokens = 0;
  private readonly dims: number | null;
  private encoder: Promise<LocalEncoder> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: LocalEmbeddingsOptions) {
    this.dims = options.dimensions ?? null;
    const name = `local/${options.model}`;
    this.model = this.dims ? `${name}@${this.dims}` : name;
    this.maxDistance = options.maxDistance ?? 0.85;
  }

  /** Loads the model now (downloading it the first time), so the first question doesn't wait for it. */
  async warmUp(): Promise<void> {
    await this.embed(["warm up"], "query");
  }

  private load(): Promise<LocalEncoder> {
    this.encoder ??= (this.options.load ?? loadWithTransformers)(this.options).catch((error) => {
      // Tried again on the next call (a download that failed, a model put in place later).
      this.encoder = null;
      throw error;
    });
    return this.encoder;
  }

  async embed(
    texts: string[],
    kind: "document" | "query",
    options: { signal?: AbortSignal } = {},
  ): Promise<EmbedResult> {
    const known = prefixesFor(this.options.model);
    const prefix =
      (kind === "query"
        ? (this.options.queryPrefix ?? known?.query)
        : (this.options.documentPrefix ?? known?.document)) ?? "";
    const inputs = texts.map((t) => prefix + t);
    const batchSize = this.options.batchSize ?? 16;
    const vectors: number[][] = [];
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const run = this.queue.then(async () => {
        // A question whose answer already went ahead without it isn't worth the CPU.
        options.signal?.throwIfAborted();
        return (await this.load())(batch);
      });
      this.queue = run.catch(() => {});
      const result = await run;
      if (result.length !== batch.length) {
        throw new Error(`Local embeddings returned ${result.length} vectors for ${batch.length} texts`);
      }
      vectors.push(...result.map((v) => fitDimensions(v, this.dims)));
    }
    // Nothing is billed; the count (about 4 characters a token) keeps usage comparable with hosted models.
    return { vectors, tokens: Math.ceil(inputs.reduce((n, t) => n + t.length, 0) / 4) };
  }
}

/** Loads the model with transformers.js (onnxruntime-node underneath), an optional dependency. */
async function loadWithTransformers(options: LocalEmbeddingsOptions): Promise<LocalEncoder> {
  let transformers: typeof import("@huggingface/transformers");
  try {
    transformers = await import("@huggingface/transformers");
  } catch (error) {
    throw new Error(
      `Local embeddings need the optional package @huggingface/transformers (pnpm install): ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
  if (options.cacheDir) transformers.env.cacheDir = options.cacheDir;
  if (options.offline) transformers.env.allowRemoteModels = false;
  const extract = await transformers.pipeline("feature-extraction", options.model, {
    dtype: (options.dtype ?? "q8") as "q8",
  });
  return async (texts) => {
    const output = await extract(texts, { pooling: "mean", normalize: true });
    return output.tolist() as number[][];
  };
}
