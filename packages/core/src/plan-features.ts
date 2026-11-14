import { type Db, plans, type Tx, tenants } from "@traiblazer/db";
import type { PlanFeature } from "@traiblazer/shared";
import { eq } from "drizzle-orm";

/** The plan column that switches each feature on. */
const FEATURE_COLUMNS = { insights: plans.insights } as const satisfies Record<PlanFeature, unknown>;

/**
 * Whether the business's plan includes a feature (operators switch features per plan in the
 * operator console). The one place every premium check goes through: API routes, the chat engine
 * and the worker.
 */
export async function planAllows(db: Db | Tx, tenantId: string, feature: PlanFeature): Promise<boolean> {
  const [row] = await db
    .select({ allowed: FEATURE_COLUMNS[feature] })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.plan))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.allowed ?? false;
}

/** Every feature's switch for one plan row (sent with the session, so the admin knows what to lock). */
export function planFeatures(plan: { insights: boolean } | undefined): Record<PlanFeature, boolean> {
  return { insights: plan?.insights ?? false };
}
