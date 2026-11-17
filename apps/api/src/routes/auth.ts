import { demos, tenants, users } from "@traiblazer/db";
import { demoSignInSchema, loginSchema, signupSchema } from "@traiblazer/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../auth/password.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import { userAgencies, userTenants } from "../lib/agencies.js";
import { hashDemoCode } from "../lib/demo-access.js";
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

  /**
   * A customer signs in to their demo business with the access code an operator gave them. Limited
   * per address as well as by the route limit: codes are long and random, but guessing stays slow.
   */
  app.post("/v1/auth/demo", authRateLimit, async (request, reply) => {
    if (!(await limiter!.hit(`demo-code:${request.ip}`, config.LOGIN_ATTEMPTS_PER_ACCOUNT, 15 * 60))) {
      throw new HttpError(429, "too_many_attempts", "Too many attempts. Try again in a few minutes.");
    }
    const { code } = demoSignInSchema.parse(request.body);
    const [found] = await db
      .select({ demoId: demos.id, user: users })
      .from(demos)
      .innerJoin(tenants, eq(tenants.id, demos.tenantId))
      .innerJoin(users, eq(users.id, demos.accessUserId))
      .where(
        and(eq(demos.accessCodeHash, hashDemoCode(code)), eq(tenants.kind, "demo"), eq(users.demo, true)),
      )
      .limit(1);
    if (!found)
      throw new HttpError(401, "invalid_code", "This code doesn't work. Check it, or ask us for a new one.");

    await db.update(demos).set({ accessLastUsedAt: new Date() }).where(eq(demos.id, found.demoId));
    const session = await createSession(db, found.user.id, config.SESSION_TTL_DAYS, {
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    });
    setSessionCookie(reply, session.token, session.expiresAt);
    const { user } = found;
    return {
      user: { id: user.id, email: user.email, name: user.name, uiLanguage: user.uiLanguage, demo: true },
    };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/v1/auth/me", { preHandler: requireUser }, async (request) => {
    // The session id stays on the server (push devices are tied to it).
    const { sessionId: _, ...user } = request.user!;
    const [myTenants, myAgencies] = await Promise.all([userTenants(db, user.id), userAgencies(db, user.id)]);
    return { user, tenants: myTenants, agencies: myAgencies };
  });
}
