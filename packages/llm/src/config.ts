import { type EmbeddingProvider, OpenAICompatibleEmbeddings } from "./embeddings.js";
import { LLMGateway, parseRoutes } from "./gateway.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OfflineProvider } from "./providers/offline.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import type { LLMProvider } from "./types.js";

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Builds the gateway from environment variables.
 *
 *   ANTHROPIC_API_KEY            enables provider "anthropic"
 *   OPENROUTER_API_KEY           enables provider "openrouter"
 *   OPENAI_COMPATIBLE_BASE_URL   enables provider "openai-compatible" (+ OPENAI_COMPATIBLE_API_KEY)
 *   LLM_CHAT_ROUTES              e.g. "anthropic:claude-opus-5-5,openrouter:<model>"
 *   LLM_AUX_ROUTES               e.g. "anthropic:claude-haiku-5-5"
 *   OPENROUTER_VISION_MODELS     models on that provider that accept images ("*" for all);
 *   OPENAI_COMPATIBLE_VISION_MODELS  Claude models always do, the offline provider never does
 *
 * Without keys, everything routes to the offline provider so development and tests work.
 */
export function createGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): {
  gateway: LLMGateway;
  offline: boolean;
} {
  const providers: LLMProvider[] = [new OfflineProvider()];
  if (env.ANTHROPIC_API_KEY) providers.push(new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY }));
  if (env.OPENROUTER_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider("openrouter", {
        apiKey: env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        headers: { "X-Title": "Traiblazer" },
        visionModels: list(env.OPENROUTER_VISION_MODELS),
      }),
    );
  }
  if (env.OPENAI_COMPATIBLE_BASE_URL) {
    providers.push(
      new OpenAICompatibleProvider("openai-compatible", {
        apiKey: env.OPENAI_COMPATIBLE_API_KEY ?? "none",
        baseURL: env.OPENAI_COMPATIBLE_BASE_URL,
        visionModels: list(env.OPENAI_COMPATIBLE_VISION_MODELS),
      }),
    );
  }

  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
  const chat = parseRoutes(
    env.LLM_CHAT_ROUTES ?? (hasAnthropic ? "anthropic:claude-opus-5-5" : "offline:knowledge"),
  );
  const aux = parseRoutes(
    env.LLM_AUX_ROUTES ?? (hasAnthropic ? "anthropic:claude-haiku-5-5" : "offline:echo"),
  );
  const offline = [...chat, ...aux].every((r) => r.provider === "offline");

  return { gateway: new LLMGateway({ providers, routes: { chat, aux } }), offline };
}

/**
 *   EMBEDDINGS_BASE_URL / EMBEDDINGS_API_KEY / EMBEDDINGS_MODEL   e.g. Voyage AI or OpenAI
 *   EMBEDDINGS_INPUT_TYPE=true                                    send input_type (Voyage)
 */
export function createEmbeddingsFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  if (!env.EMBEDDINGS_BASE_URL || !env.EMBEDDINGS_MODEL) return null;
  return new OpenAICompatibleEmbeddings({
    baseURL: env.EMBEDDINGS_BASE_URL,
    apiKey: env.EMBEDDINGS_API_KEY ?? "",
    model: env.EMBEDDINGS_MODEL,
    sendInputType: env.EMBEDDINGS_INPUT_TYPE === "true",
  });
}
