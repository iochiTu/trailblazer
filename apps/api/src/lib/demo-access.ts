import { createHash, randomBytes, randomInt } from "node:crypto";
import { type Db, demos, memberships, sessions, users } from "@traiblazer/db";
import { DEMO_CODE_ALPHABET, DEMO_CODE_LENGTH } from "@traiblazer/shared";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";

/**
 * Customer access to a prospect demo: an operator gives the customer an access code, the customer
 * signs in with it (POST /v1/auth/demo) and tries the product as the owner of the demo business, on
 * the plan the operator chose. The demo account has no usable password and owns nothing else.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A new access code, normalized (12 characters from DEMO_CODE_ALPHABET). */
export function newDemoCode(): string {
  let code = "";
  for (let i = 0; i < DEMO_CODE_LENGTH; i++) code += DEMO_CODE_ALPHABET[randomInt(DEMO_CODE_ALPHABET.length)];
  return code;
}

/** "K7MPQ2XW9HTR" → "K7MP-Q2XW-9HTR", the way the customer is given it. */
export const formatDemoCode = (code: string) => code.match(/.{1,4}/g)!.join("-");

/** Codes are random and long enough that a plain SHA-256 is enough to find them without storing them. */
export const hashDemoCode = (normalized: string) => createHash("sha256").update(normalized).digest("hex");

/** The demo account's email: never a real address, never one a person can sign up with. */
const demoEmail = (demoId: string) => `demo-${demoId}@demo.traiblazer.invalid`;

/**
 * Gives the customer a new access code for the demo, creating its demo account (owner of the demo
 * business) the first time. Any earlier code stops working and earlier sign-ins are ended.
 * Returns the code, formatted; only its hash is kept.
 */
export async function grantDemoAccess(
  tx: Tx,
  demo: { id: string; tenantId: string; accessUserId: string | null },
  account: { name: string; uiLanguage: string },
): Promise<string> {
  let userId = demo.accessUserId;
  if (userId) {
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  } else {
    const [user] = await tx
      .insert(users)
      .values({
        email: demoEmail(demo.id),
        name: account.name,
        // Never typed by anyone: the demo account signs in with its access code only.
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
        uiLanguage: account.uiLanguage,
        demo: true,
      })
      .returning({ id: users.id });
    userId = user!.id;
    await tx.insert(memberships).values({ tenantId: demo.tenantId, userId, role: "owner" });
  }
  const code = newDemoCode();
  await tx
    .update(demos)
    .set({
      accessUserId: userId,
      accessCodeHash: hashDemoCode(code),
      accessCodeCreatedAt: new Date(),
      accessLastUsedAt: null,
    })
    .where(eq(demos.id, demo.id));
  return formatDemoCode(code);
}

/** Ends customer access: the demo account goes (with its membership and sign-ins) and so does the code. */
export async function removeDemoAccess(tx: Tx | Db, demo: { id: string; accessUserId: string | null }) {
  await tx
    .update(demos)
    .set({ accessUserId: null, accessCodeHash: null, accessCodeCreatedAt: null, accessLastUsedAt: null })
    .where(eq(demos.id, demo.id));
  // Only ever a demo account: a person's own account is never removed here.
  if (demo.accessUserId) {
    await tx.delete(users).where(and(eq(users.id, demo.accessUserId), eq(users.demo, true)));
  }
}
