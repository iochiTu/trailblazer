import type { Db } from "@traiblazer/db";
import type { IntegrationsConfig } from "@traiblazer/integrations";
import type { LLMGateway, QueryEmbedder } from "@traiblazer/llm";
import type { TelephonyProvider } from "@traiblazer/telephony";
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
  /** Phone and SMS provider (docs/PHONE_AND_SMS.md); null or absent: those routes don't exist. */
  telephony?: TelephonyProvider | null;
  /** Directory with the built chat page and widget (apps/chat/dist). */
  chatDistDir?: string;
  /** Shared store for rate limits (needed with several API servers). */
  redis?: Redis | null;
  /** Per-business rate and concurrency limits; in-memory when not provided. */
  limiter?: Limiter;
  /** Plans and policies from the operator console; created from `db` when not provided. */
  platform?: PlatformConfig;
  /** CRM connections: the key that seals credentials and the platform's own CRM keys. Off when absent. */
  integrations?: IntegrationsConfig;
  /** Outbound HTTP for CRM calls; defaults to one that refuses private addresses. Tests pass a fake. */
  integrationsFetch?: typeof fetch;
}
