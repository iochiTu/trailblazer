import { memberships, tenants, users } from "@traiblazer/db";
import { loginSchema, signupSchema } from "@traiblazer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../auth/password.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import { conflict, HttpError } from "../lib/errors.js";
import { requireUser } from "../plugins/auth.js";

export async function authRoutes(app: FastifyInstance, { db, config, limiter }: AppContext) {
  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date) => {
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.COOKIE_SECURE,
      expires: expiresAt,
    });
  };

  // Stricter rate limit on credential endpoints.
  const authRateLimit = {
    config: { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } },
  };

  app.post("/v1/auth/signup", authRateLimit, async (request, reply) => {
    const input = signupSchema.parse(request.body);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing.length) throw conflict("An account with this email already exists");

    const [user] = await db
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        uiLanguage: input.uiLanguage ?? "en",
      })
      .returning({ id: users.id, email: users.email, name: users.name, uiLanguage: users.uiLanguage });

    const session = await createSession(db, user!.id, config.SESSION_TTL_DAYS, {
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    });
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.code(201).send({ user });
  });

  app.post("/v1/auth/login", authRateLimit, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    if (!(await limiter!.hit(`login:${input.email}`, config.LOGIN_ATTEMPTS_PER_ACCOUNT, 15 * 60))) {
      throw new HttpError(429, "too_many_attempts", "Too many sign-in attempts. Try again in a few minutes.");
    }
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const ok = user
      ? await verifyPassword(input.password, user.passwordHash)
      : await verifyAgainstDummy(input.password);
    if (!user || !ok) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");

    const session = await createSession(db, user.id, config.SESSION_TTL_DAYS, {
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    });
    setSessionCookie(reply, session.token, session.expiresAt);
    return { user: { id: user.id, email: user.email, name: user.name, uiLanguage: user.uiLanguage } };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/v1/auth/me", { preHandler: requireUser }, async (request) => {
    const user = request.user!;
    const myTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, user.id))
      .orderBy(tenants.name);
    return { user, tenants: myTenants };
  });
}
