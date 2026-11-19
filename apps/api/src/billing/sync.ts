import type { PlatformConfig } from "@traiblazer/core";
import { billingAccounts, type Db, tenants, withTenant } from "@traiblazer/db";
import { PAYING_STATUSES } from "@traiblazer/shared";
import { eq } from "drizzle-orm";
import { audit } from "../lib/audit.js";
import type { SubscriptionSnapshot } from "./provider.js";

export const isPaying = (status: string | null | undefined) =>
  !!status && (PAYING_STATUSES as readonly string[]).includes(status);

/** Statuses after which the business no longer pays: it goes back to the plan new businesses start on. */
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired", "paused"]);

export const isEnded = (status: string | null) => status !== null && ENDED.has(status);

export type SyncResult = "applied" | "unknown_customer" | "stale";

/**
 * Brings our copy of a subscription up to date and puts the business on the plan it pays for.
 * Always called with the subscription as the provider has it now (never the event's copy), so
 * events arriving late or twice change nothing.
 */
export async function applySubscription(
  db: Db,
  platform: PlatformConfig,
  sub: SubscriptionSnapshot,
): Promise<SyncResult> {
  const [account] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.stripeCustomerId, sub.customerId))
    .limit(1);
  // A customer we didn't create, or one whose subscription says it belongs to another business.
  if (!account || (sub.tenantId && sub.tenantId !== account.tenantId)) return "unknown_customer";
  // An older subscription of the same customer ending doesn't touch the one that pays now.
  if (
    account.stripeSubscriptionId &&
    account.stripeSubscriptionId !== sub.id &&
    isPaying(account.status) &&
    !isPaying(sub.status)
  ) {
    return "stale";
  }

  const allPlans = await platform.plans();
  const policies = await platform.policies();
  let plan: string | null = null;
  if (isPaying(sub.status)) {
    plan = allPlans.find((p) => p.id === sub.planId)?.id ?? null;
  } else if (isEnded(sub.status)) {
    plan = allPlans.find((p) => p.id === policies.defaultPlan && p.active)?.id ?? "trial";
  }

  const planChanged = await db.transaction(async (tx) => {
    await tx
      .update(billingAccounts)
      .set({
        stripeSubscriptionId: sub.id,
        status: sub.status,
        plan: sub.planId,
        priceMonthlyCents: sub.priceMonthlyCents,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAt: sub.cancelAt,
      })
      .where(eq(billingAccounts.tenantId, account.tenantId));
    if (!plan) return null;
    const [tenant] = await tx
      .select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, account.tenantId))
      .for("update")
      .limit(1);
    if (!tenant || tenant.plan === plan) return null;
    await tx.update(tenants).set({ plan }).where(eq(tenants.id, account.tenantId));
    return { from: tenant.plan, to: plan };
  });

  // Recorded in the business's own log, so the owner sees why the plan or the payment status changed.
  if (planChanged || account.status !== sub.status) {
    await withTenant(db, account.tenantId, (tx) =>
      audit(tx, {
        tenantId: account.tenantId,
        actorUserId: null,
        action: "billing.subscription",
        targetType: "subscription",
        targetId: sub.id,
        metadata: {
          status: sub.status,
          ...(account.status !== sub.status ? { previousStatus: account.status } : {}),
          ...(planChanged ? { plan: planChanged.to, previousPlan: planChanged.from } : {}),
        },
      }),
    );
  }
  return "applied";
}
