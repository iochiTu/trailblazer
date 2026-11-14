import { createHash, randomBytes } from "node:crypto";
import { type Db, type PlatformRole, sessions, users } from "@traiblazer/db";
import { and, eq, gt } from "drizzle-orm";

export const SESSION_COOKIE = "tb_session";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  uiLanguage: string;
  /**
   * Traiblazer staff role, null for business users. Read fresh on every request, so revoking takes
   * effect immediately.
   */
  platformRole: PlatformRole | null;
  /** A prospect's demo account (signed in with an access code; owns its demo business only). */
  demo: boolean;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(
  db: Db,
  userId: string,
  ttlDays: number,
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 400),
    ip: meta.ip,
  });
  return { token, expiresAt };
}

export async function getSessionUser(db: Db, token: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      uiLanguage: users.uiLanguage,
      platformRole: users.platformRole,
      demo: users.demo,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
