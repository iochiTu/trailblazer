import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { SESSION_COOKIE } from "./auth/sessions.js";
import type { AppContext } from "./context.js";
import { HttpError } from "./lib/errors.js";
import { MemoryLimiter } from "./lib/limiter.js";
import { PlatformConfig } from "./lib/platform.js";
import { auditSupportChanges, loadUser } from "./plugins/auth.js";
import { addonRoutes } from "./routes/addons.js";
import { assetRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { botRoutes } from "./routes/bots.js";
import { catalogRoutes } from "./routes/catalog.js";
import { gapRoutes } from "./routes/gaps.js";
import { interviewRoutes } from "./routes/interview.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { leadRoutes } from "./routes/leads.js";
import { operatorRoutes } from "./routes/operator.js";
import { pageRoutes } from "./routes/page.js";
import { publicRoutes } from "./routes/public.js";
import { setupRoutes } from "./routes/setup.js";
import { tenantRoutes } from "./routes/tenants.js";
import { usageRoutes } from "./routes/usage.js";

export async function buildApp(input: AppContext): Promise<FastifyInstance> {
  const ctx: AppContext = {
    ...input,
    limiter: input.limiter ?? new MemoryLimiter(),
    platform: input.platform ?? new PlatformConfig(input.db, input.config.PLATFORM_CACHE_SECONDS * 1000),
  };
  const app = Fastify({
    logger:
      ctx.config.NODE_ENV === "test"
        ? false
        : {
            level: ctx.config.LOG_LEVEL,
            redact: ["req.headers.cookie", 'res.headers["set-cookie"]'],
            ...(ctx.config.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
          },
    trustProxy: ctx.config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  // The chat page sets its own CSP with per-bot frame-ancestors, so X-Frame-Options is off globally.
  await app.register(helmet, { contentSecurityPolicy: false, frameguard: false });
  await app.register(cookie);
  // Per-IP limits; stored in Redis when available so they add up across API servers.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    enableDraftSpec: true,
    ...(ctx.redis ? { redis: ctx.redis, nameSpace: "tb:ip:" } : {}),
  });

  // Cross-site request check (defence in depth on top of SameSite=Lax cookies): a state-changing
  // request that carries the session cookie, or signs in/up, must come from the admin portal or this
  // service. Requests without browser origin headers (server-to-server, CLI) are not affected.
  const trustedOrigins = new Set([
    new URL(ctx.config.ADMIN_ORIGIN).origin,
    new URL(ctx.config.PUBLIC_URL).origin,
  ]);
  app.addHook("onRequest", async (request) => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    if (request.url.startsWith("/v1/public/")) return;
    if (!request.cookies[SESSION_COOKIE] && !request.url.startsWith("/v1/auth/")) return;
    const origin = request.headers.origin;
    const crossSite = origin
      ? !trustedOrigins.has(origin)
      : request.headers["sec-fetch-site"] === "cross-site";
    if (crossSite) throw new HttpError(403, "cross_site_request", "Cross-site requests are not allowed");
  });

  app.decorateRequest("user", null);
  app.decorateRequest("tenant", null);
  app.addHook("onRequest", loadUser(ctx.db));
  app.addHook("onSend", auditSupportChanges(ctx.db));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid request",
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "bad_request", message: (error as Error).message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "internal_error", message: "Something went wrong" });
  });

  app.get("/health", async () => {
    await ctx.db.execute(sql`select 1`);
    return { ok: true };
  });

  await app.register(async (scope) => authRoutes(scope, ctx));
  await app.register(async (scope) => tenantRoutes(scope, ctx));
  await app.register(async (scope) => botRoutes(scope, ctx));
  await app.register(async (scope) => addonRoutes(scope, ctx));
  await app.register(async (scope) => catalogRoutes(scope, ctx));
  await app.register(async (scope) => knowledgeRoutes(scope, ctx));
  await app.register(async (scope) => pageRoutes(scope, ctx));
  await app.register(async (scope) => leadRoutes(scope, ctx));
  await app.register(async (scope) => gapRoutes(scope, ctx));
  await app.register(async (scope) => setupRoutes(scope, ctx));
  await app.register(async (scope) => interviewRoutes(scope, ctx));
  await app.register(async (scope) => assetRoutes(scope, ctx));
  await app.register(async (scope) => usageRoutes(scope, ctx));
  await app.register(async (scope) => operatorRoutes(scope, ctx));
  await app.register(async (scope) => publicRoutes(scope, ctx));

  return app;
}
