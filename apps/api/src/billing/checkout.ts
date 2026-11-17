import { randomUUID } from "node:crypto";
import { billingAccounts, type Db } from "@traiblazer/db";
import { eq } from "drizzle-orm";
import { HttpError } from "../lib/errors.js";
import type { BillingProvider, CheckoutInput, CheckoutSession } from "./provider.js";
import { isEnded, isPaying } from "./sync.js";

type Request = Pick<CheckoutInput, "tenantId" | "productId" | "plan" | "setupFeeCents" | "language"> & {
  returnUrl: string;
};
const processing = () =>
  new HttpError(
    409,
    "checkout_processing",
    "A completed payment is being processed. Refresh billing before starting another checkout.",
  );

type Attempt = NonNullable<typeof billingAccounts.$inferSelect.checkoutAttempt>;

/** Use the original request on retries, even when the owner just selected a different plan. */
async function recoverSession(
  provider: BillingProvider,
  attempt: Attempt,
  tenantId: string,
  customerId: string,
): Promise<CheckoutSession | undefined> {
  if (attempt.sessionId) return provider.getCheckout(attempt.sessionId);
  // The create response may have been lost. Recover the live status before replaying the request.
  const [session] = await provider.findCheckouts(customerId, attempt.id);
  if (session) return session;
  // A new Stripe session needs at least 30 minutes before its expiry.
  if (attempt.expiresAt - Math.floor(Date.now() / 1000) <= 31 * 60) return undefined;
  return provider.createCheckout({
    tenantId,
    customerId,
    plan: { id: attempt.plan, priceMonthlyCents: attempt.monthlyCents },
    productId: attempt.productId,
    language: attempt.language,
    setupFeeCents: attempt.setupFeeCents,
    attemptId: attempt.id,
    expiresAt: attempt.expiresAt,
    successUrl: `${attempt.returnUrl}?checkout=done`,
    cancelUrl: `${attempt.returnUrl}?checkout=cancelled`,
  });
}

/** Save the attempt before contacting Stripe. A retry after a lost response uses the original key and prices. */
export async function startCheckout(db: Db, provider: BillingProvider, input: Request) {
  const accountFilter = eq(billingAccounts.tenantId, input.tenantId);
  let reserved: string | undefined;
  for (;;) {
    const result = await db.transaction(async (tx) => {
      const [account] = await tx.select().from(billingAccounts).where(accountFilter).for("update");
      if (!account) throw new Error("Billing account missing");
      if (isPaying(account.status))
        throw new HttpError(
          409,
          "already_subscribed",
          "This business already pays for a plan. Change plans instead.",
        );
      const attempt = account.checkoutAttempt;
      if (reserved && attempt?.id !== reserved)
        throw new HttpError(
          409,
          "checkout_changed",
          "Another checkout was started. Refresh billing and try again.",
        );
      const customerId = account.stripeCustomerId;
      const setupFeeCents = account.setupFeePaidAt ? 0 : input.setupFeeCents;
      if (!attempt) {
        // Sessions issued before this migration can still accept payment.
        for (const legacy of await provider.findCheckouts(customerId, null)) {
          if (legacy.status === "open") await provider.expireCheckout(legacy.id);
          if (legacy.status === "complete") {
            if (!legacy.subscriptionId) throw processing();
            const sub = await provider.getSubscription(legacy.subscriptionId);
            if (sub && !isEnded(sub.status)) throw processing();
          }
        }
      } else {
        const session = await recoverSession(provider, attempt, input.tenantId, customerId);
        if (
          session?.status === "complete" &&
          !(
            session.subscriptionId &&
            session.subscriptionId === account.stripeSubscriptionId &&
            isEnded(account.status)
          )
        )
          throw processing();
        if (session?.status === "open") {
          if (
            attempt.plan === input.plan.id &&
            attempt.monthlyCents === input.plan.priceMonthlyCents &&
            attempt.setupFeeCents === setupFeeCents
          ) {
            if (!session.url) throw new Error("Open checkout has no URL");
            if (!attempt.sessionId)
              await tx
                .update(billingAccounts)
                .set({ checkoutAttempt: { ...attempt, sessionId: session.id } })
                .where(accountFilter);
            return { url: session.url };
          }
          // If payment wins the race, expiry fails and no replacement can be created.
          await provider.expireCheckout(session.id);
        }
      }
      const id = randomUUID();
      await tx
        .update(billingAccounts)
        .set({
          checkoutAttempt: {
            id,
            plan: input.plan.id,
            monthlyCents: input.plan.priceMonthlyCents,
            setupFeeCents,
            productId: input.productId,
            language: input.language,
            returnUrl: input.returnUrl,
            expiresAt: Math.floor(Date.now() / 1000) + 24 * 3600,
          },
        })
        .where(accountFilter);
      return { id };
    });
    if (result.url) return result.url;
    reserved = result.id;
  }
}
