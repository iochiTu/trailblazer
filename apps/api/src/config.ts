import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  /** Application role connection (RLS applies). */
  DATABASE_APP_URL: z.string().default("postgres://traiblazer_app:traiblazer_app@localhost:5433/traiblazer"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Max sign-up/sign-in attempts per IP per minute. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  /**
   * Max sign-in attempts for one account per 15 minutes, from any IP (slows down password guessing
   * spread over many addresses).
   */
  LOGIN_ATTEMPTS_PER_ACCOUNT: z.coerce.number().int().positive().default(20),
  /**
   * Which proxies may set X-Forwarded-For (client IP for rate limits and logs): "true" (any, only
   * when the API is unreachable except through your proxy) or a comma-separated list
   * of addresses, CIDR ranges and the names loopback, linklocal, uniquelocal.
   */
  TRUST_PROXY: z
    .string()
    .default("loopback,uniquelocal")
    .transform((v): boolean | string => (v === "true" ? true : v === "false" ? false : v)),
  LOG_LEVEL: z.string().default("info"),
  /** Public origin of this service: chat page links, widget script and same-origin checks. */
  PUBLIC_URL: z.url().default("http://localhost:4000"),
  /**
   * Public origin the telephony provider calls for webhooks, when it differs from PUBLIC_URL (a
   * tunnel in development). Signatures are checked against this address.
   */
  TELEPHONY_WEBHOOK_URL: z.url().optional(),
  /** Admin portal origin; allowed to frame the chat page (playground). */
  ADMIN_ORIGIN: z.url().default("http://localhost:3000"),
  /**
   * Overrides for operator policies (set in the operator console), mainly for tests and load tests:
   * chat messages per IP per minute, and questions per conversation.
   */
  CHAT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().optional(),
  CONVERSATION_MAX_QUESTIONS: z.coerce.number().int().positive().optional(),
  /** How long plans and policies are cached per API server. */
  PLATFORM_CACHE_SECONDS: z.coerce.number().int().min(0).default(30),
  /**
   * Public marketing site (pricing and local pages, llms.txt) the MCP server links to; defaults to
   * ADMIN_ORIGIN, where those pages are served.
   */
  SITE_URL: z.url().optional(),
  /** Public address of the MCP server, as announced to AI assistants (default: SITE_URL + /api/mcp). */
  MCP_PUBLIC_URL: z.url().optional(),
  /**
   * Company details published on the marketing pages, llms.txt and the MCP server. Each one is
   * optional and simply left out when not set.
   */
  BUSINESS_LEGAL_NAME: z.string().optional(),
  BUSINESS_EMAIL: z.string().optional(),
  BUSINESS_PHONE: z.string().optional(),
  BUSINESS_STREET: z.string().optional(),
  BUSINESS_CITY: z.string().optional(),
  BUSINESS_REGION: z.string().optional(),
  BUSINESS_POSTAL_CODE: z.string().optional(),
  BUSINESS_COUNTRY: z.string().optional(),
  /** Shared rate limits and counters across API servers. Without it, limits are per server. */
  REDIS_URL: z.string().optional(),
  /** How long an answer waits for the question's vector once the keyword search is ready (docs/EMBEDDINGS.md). */
  EMBEDDINGS_QUERY_WAIT_MS: z.coerce.number().int().min(0).max(5000).default(250),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
