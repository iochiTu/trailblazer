import type { Db } from "@traiblazer/db";
import type { LLMGateway, QueryEmbedder } from "@traiblazer/llm";
import type { Redis } from "ioredis";
import type { AppConfig } from "./config.js";
import type { Limiter } from "./lib/limiter.js";
import type { PlatformConfig } from "./lib/platform.js";

export interface AppContext {
  db: Db;
  config: AppConfig;
  gateway: LLMGateway;
  /** Embeds visitors' questions for search by meaning (null: keyword search only). */
  embeddings?: QueryEmbedder | null;
  /** Directory with the built chat page and widget (apps/chat/dist). */
  chatDistDir?: string;
  /** Shared store for rate limits (needed with several API servers). */
  redis?: Redis | null;
  /** Per-business rate and concurrency limits; in-memory when not provided. */
  limiter?: Limiter;
  /** Plans and policies from the operator console; created from `db` when not provided. */
  platform?: PlatformConfig;
}
