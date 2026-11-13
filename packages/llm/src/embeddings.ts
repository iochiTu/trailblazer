import { createHash } from "node:crypto";

/**
 * Embedding providers (search by meaning, docs/EMBEDDINGS.md). Optional: retrieval falls back to
 * keyword + fuzzy search without one, and whenever one is slow or failing.
 */

export interface EmbedResult {
  vectors: number[][];
  /** Tokens the provider counted (estimated when it doesn't say). */
  tokens: number;
}

export interface EmbeddingProvider {
  /**
   * Stored with each vector, e.g. "voyage-4-lite@512"; only vectors of the same model are compared.
   * The size is part of it, so a change of size counts as a change of model.
   */
  readonly model: string;
  /** Vector search results farther than this cosine distance (0–2) don't count. */
  readonly maxDistance: number;
  /** Price in US dollars per million tokens, for usage records. */
  readonly pricePerMillionTokens: number;
  embed(
    texts: string[],
    kind: "document" | "query",
    options?: { signal?: AbortSignal },
  ): Promise<EmbedResult>;
}

/** Cost of an embedding call in micro-dollars. */
export const embeddingCostMicros = (provider: EmbeddingProvider, tokens: number) =>
  Math.round(tokens * provider.pricePerMillionTokens);

/**
 * Cuts a vector to its first `dims` numbers and scales it back to length 1. Models trained for it
 * (Matryoshka: Voyage 4, OpenAI 3, most recent open models) keep most of their quality at 512.
 */
export function fitDimensions(vector: number[], dims: number | null): number[] {
  const cut = dims && vector.length > dims ? vector.slice(0, dims) : vector;
  const norm = Math.sqrt(cut.reduce((sum, x) => sum + x * x, 0));
  return norm > 0 ? cut.map((x) => x / norm) : cut;
}

/** A failure worth trying again: rate limit, server error, network or timeout. */
class RetryableError extends Error {}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  /** Vector size to keep (and to ask for when the provider can make shorter vectors). */
  dimensions?: number | null;
  /** How the provider is asked for `dimensions`: OpenAI "dimensions", Voyage "output_dimension". */
  dimensionsParam?: "dimensions" | "output_dimension" | null;
  /** Send `input_type: "query" | "document"` (Voyage). */
  sendInputType?: boolean;
  /** Text put before each query / document (e5-style models: "query: ", "passage: "). */
  queryPrefix?: string;
  documentPrefix?: string;
  /** Texts per request (default 128). */
  batchSize?: number;
  maxDistance?: number;
  pricePerMillionTokens?: number;
  /** Per request, for documents (queries use the caller's signal). Default 30 s. */
  timeoutMs?: number;
  /** Tries again for documents after a rate limit or server error (default 3). */
  retries?: number;
  fetch?: typeof fetch;
}

/**
 * OpenAI-style `/embeddings` endpoint (OpenAI, Voyage AI, OpenRouter, Azure OpenAI v1, Ollama, vLLM, …).
 * Documents are retried with backoff; queries are never retried, as the answer won't wait for them.
 */
export class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  readonly model: string;
  readonly maxDistance: number;
  readonly pricePerMillionTokens: number;
  private readonly dims: number | null;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.dims = options.dimensions ?? null;
    this.model = this.dims ? `${options.model}@${this.dims}` : options.model;
    // Keeps every answering chunk for the models measured (docs/EMBEDDINGS.md §7); tune per model.
    this.maxDistance = options.maxDistance ?? 0.85;
    this.pricePerMillionTokens = options.pricePerMillionTokens ?? 0.02;
  }

  async embed(
    texts: string[],
    kind: "document" | "query",
    options: { signal?: AbortSignal } = {},
  ): Promise<EmbedResult> {
    const batchSize = this.options.batchSize ?? 128;
    const prefix = (kind === "query" ? this.options.queryPrefix : this.options.documentPrefix) ?? "";
    const vectors: number[][] = [];
    let tokens = 0;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => prefix + t);
      const tries = kind === "document" ? (this.options.retries ?? 3) + 1 : 1;
      for (let attempt = 1; ; attempt++) {
        try {
          const result = await this.request(batch, kind, options.signal);
          vectors.push(...result.vectors);
          tokens += result.tokens;
          break;
        } catch (error) {
          if (!(error instanceof RetryableError) || attempt >= tries || options.signal?.aborted) throw error;
          await sleep(500 * 2 ** (attempt - 1), options.signal);
        }
      }
    }
    return { vectors, tokens };
  }

  private async request(batch: string[], kind: "document" | "query", signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
    const doFetch = this.options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.options.baseURL.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model,
          input: batch,
          ...(this.options.sendInputType ? { input_type: kind } : {}),
          ...(this.dims && this.options.dimensionsParam ? { [this.options.dimensionsParam]: this.dims } : {}),
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new RetryableError(
        `Embeddings request failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!res.ok) {
      const message = `Embeddings request failed: ${res.status} ${(await res.text()).slice(0, 300)}`;
      throw res.status === 429 || res.status >= 500 ? new RetryableError(message) : new Error(message);
    }
    const body = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
      usage?: { total_tokens?: number; prompt_tokens?: number };
    };
    if (body.data?.length !== batch.length) {
      throw new Error(
        `Embeddings request returned ${body.data?.length ?? 0} vectors for ${batch.length} texts`,
      );
    }
    const sorted = [...body.data].sort((a, b) => a.index - b.index);
    return {
      vectors: sorted.map((d) => fitDimensions(d.embedding, this.dims)),
      // Some routers (OpenRouter) report 0: estimate instead (about 4 characters a token).
      tokens:
        body.usage?.total_tokens ||
        body.usage?.prompt_tokens ||
        Math.ceil(batch.reduce((n, t) => n + t.length, 0) / 4),
    };
  }
}

// ---- Questions: cache, deadline, circuit breaker ----------------------------------------------

/** Shared cache of question vectors (Redis in the API), keyed by model and text. */
export interface VectorCache {
  get(key: string): Promise<number[] | null>;
  set(key: string, vector: number[]): Promise<void>;
}

export interface QueryVector {
  vector: number[];
  model: string;
  maxDistance: number;
  /** Tokens paid for: 0 when it came from a cache. */
  tokens: number;
  costMicros: number;
}

export interface QueryEmbedderOptions {
  cache?: VectorCache | null;
  /** Longest the shared cache is waited for before asking the provider (default 100 ms). */
  cacheWaitMs?: number;
  /** Vectors kept in this process (default 5,000). */
  memorySize?: number;
  /** Longest a provider call may take (default 2 s); the answer waits much less (see withDeadline). */
  timeoutMs?: number;
  /** Failures in a row that make it stop asking for a while (default 5)… */
  failuresToOpen?: number;
  /** …and for how long (default 30 s). */
  openMs?: number;
  now?: () => number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/**
 * Embeds visitors' questions. Never throws: anything that goes wrong gives null, and the answer uses
 * keyword search alone. The same question asked at the same time is embedded once; repeated questions
 * come from memory, then the shared cache. After several failures in a row the provider isn't asked
 * for a while, so an outage doesn't cost every answer a timeout.
 */
export class QueryEmbedder {
  private readonly memory = new Map<string, number[]>();
  private readonly pending = new Map<string, Promise<QueryVector | null>>();
  private failures = 0;
  private openUntil = 0;

  constructor(
    readonly provider: EmbeddingProvider,
    private readonly options: QueryEmbedderOptions = {},
  ) {}

  get model(): string {
    return this.provider.model;
  }

  /** The text that is embedded and its cache key. */
  static normalize(text: string): string {
    return text.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 2000);
  }

  embed(text: string): Promise<QueryVector | null> {
    const input = QueryEmbedder.normalize(text);
    if (!input) return Promise.resolve(null);
    const key = `${this.provider.model}:${input.toLowerCase()}`;
    const remembered = this.remember(key);
    if (remembered) return Promise.resolve(this.result(remembered, 0));
    const running = this.pending.get(key);
    if (running) return running;
    const job = this.fetch(key, input).finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }

  private async fetch(key: string, input: string): Promise<QueryVector | null> {
    const cacheKey = `emb:${createHash("sha256").update(key).digest("hex")}`;
    if (this.options.cache) {
      try {
        // A cache that doesn't answer at once (Redis down, reconnecting) isn't waited for.
        const cached = await withDeadline(this.options.cache.get(cacheKey), this.options.cacheWaitMs ?? 100);
        if (cached?.length) {
          this.keep(key, cached);
          return this.result(cached, 0);
        }
      } catch {
        // The cache is a shortcut only.
      }
    }
    const now = this.options.now ?? Date.now;
    if (now() < this.openUntil) return null;
    try {
      const { vectors, tokens } = await this.provider.embed([input], "query", {
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 2000),
      });
      const vector = vectors[0];
      if (!vector?.length) throw new Error("No vector returned");
      this.failures = 0;
      this.keep(key, vector);
      this.options.cache?.set(cacheKey, vector).catch(() => {});
      return this.result(vector, tokens);
    } catch (error) {
      this.failures++;
      const opening = this.failures >= (this.options.failuresToOpen ?? 5);
      if (opening) {
        this.openUntil = now() + (this.options.openMs ?? 30_000);
        this.failures = 0;
      }
      this.options.log?.("embedding failed", {
        error: error instanceof Error ? error.message : String(error),
        model: this.provider.model,
        ...(opening ? { pausedMs: this.options.openMs ?? 30_000 } : {}),
      });
      return null;
    }
  }

  private result(vector: number[], tokens: number): QueryVector {
    return {
      vector,
      model: this.provider.model,
      maxDistance: this.provider.maxDistance,
      tokens,
      costMicros: embeddingCostMicros(this.provider, tokens),
    };
  }

  /** Least recently used out first. */
  private remember(key: string): number[] | undefined {
    const vector = this.memory.get(key);
    if (vector) {
      this.memory.delete(key);
      this.memory.set(key, vector);
    }
    return vector;
  }

  private keep(key: string, vector: number[]) {
    this.memory.set(key, vector);
    const max = this.options.memorySize ?? 5000;
    while (this.memory.size > max) this.memory.delete(this.memory.keys().next().value!);
  }
}

/**
 * The promise's value if it settles within `ms`, otherwise null (it keeps running, and a value it
 * brings later still fills the caches). `onLate` is called when the time ran out.
 */
export function withDeadline<T>(
  promise: Promise<T | null>,
  ms: number,
  onLate?: () => void,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        onLate?.();
        resolve(null);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
