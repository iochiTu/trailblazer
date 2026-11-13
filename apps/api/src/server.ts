import { fileURLToPath } from "node:url";
import { createDb } from "@traiblazer/db";
import { loadIntegrationsConfig } from "@traiblazer/integrations";
import { createEmbeddingsFromEnv, createGatewayFromEnv } from "@traiblazer/llm";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryLimiter, RedisLimiter } from "./lib/limiter.js";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_APP_URL);
const { gateway, offline } = createGatewayFromEnv();
const embeddings = createEmbeddingsFromEnv();
const chatDistDir = process.env.CHAT_DIST_DIR ?? fileURLToPath(new URL("../../chat/dist", import.meta.url));

// Redis makes rate limits and per-business limits shared by every API server.
const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
const limiter = redis ? new RedisLimiter(redis) : new MemoryLimiter();

// CRM connections (Jobber, ServiceTitan…): off without INTEGRATIONS_SECRET_KEY.
const integrations = loadIntegrationsConfig(process.env);

const app = await buildApp({ db, config, gateway, embeddings, chatDistDir, redis, limiter, integrations });
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
if (!integrations.secretKey) {
  app.log.warn("INTEGRATIONS_SECRET_KEY not set: CRM add-ons (Jobber, ServiceTitan…) can't be connected.");
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
