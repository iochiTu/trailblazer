import { fileURLToPath } from "node:url";
import { createDb } from "@traiblazer/db";
import {
  createEmbeddingsFromEnv,
  createGatewayFromEnv,
  LocalEmbeddings,
  QueryEmbedder,
} from "@traiblazer/llm";
import { createTelephonyFromEnv } from "@traiblazer/telephony";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryLimiter, RedisLimiter } from "./lib/limiter.js";
import { RedisVectorCache } from "./lib/vector-cache.js";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_APP_URL);
const { gateway, offline } = createGatewayFromEnv();
const embeddingProvider = createEmbeddingsFromEnv();
const chatDistDir = process.env.CHAT_DIST_DIR ?? fileURLToPath(new URL("../../chat/dist", import.meta.url));

// Redis makes rate limits and per-business limits shared by every API server.
const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
const limiter = redis ? new RedisLimiter(redis) : new MemoryLimiter();

// Search by meaning: question vectors cached in this process and in Redis (docs/EMBEDDINGS.md).
const embeddings = embeddingProvider
  ? new QueryEmbedder(embeddingProvider, {
      cache: redis ? new RedisVectorCache(redis) : null,
      log: (msg, data) => console.warn(JSON.stringify({ msg, ...data })),
    })
  : null;

// A model run in this process is loaded now, so the first visitor's question doesn't wait for it.
if (embeddingProvider instanceof LocalEmbeddings) {
  const started = Date.now();
  void embeddingProvider.warmUp().then(
    () =>
      console.log(
        JSON.stringify({
          msg: "embedding model loaded",
          model: embeddingProvider.model,
          ms: Date.now() - started,
        }),
      ),
    (error: unknown) =>
      console.warn(
        JSON.stringify({
          msg: "embedding model failed to load",
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
  );
}

// Phone and SMS (docs/PHONE_AND_SMS.md): the webhook routes exist only when a provider is configured.
const telephony = createTelephonyFromEnv();

const app = await buildApp({ db, config, gateway, embeddings, telephony, chatDistDir, redis, limiter });
if (offline) {
  app.log.warn(
    "No LLM API key configured: chat answers come from the offline test provider (set ANTHROPIC_API_KEY).",
  );
} else if (!gateway.supportsTools("chat")) {
  // Tools are dropped for models not listed as able to call them, so this fails silently otherwise.
  app.log.warn(
    "No chat model can call tools: assistants can't save visitors' requests or check service areas. List the model in OPENROUTER_TOOL_MODELS or OPENAI_COMPATIBLE_TOOL_MODELS.",
  );
}
if (!redis) app.log.warn("REDIS_URL not set: rate limits are kept per server (fine for one server).");

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await close();
  redis?.disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.API_PORT, host: config.API_HOST });
