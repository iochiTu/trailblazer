import { bots, demos, documents, knowledgeSources, setupRuns, tenants, withTenant } from "@traiblazer/db";
import { count, eq } from "drizzle-orm";
import { applySetup, suggestionToInput } from "../setup/apply.js";
import { runSetup, type SetupDeps } from "../setup/setup.js";

/**
 * Builds a prospect demo (PLAN §2.2, §7.5): once the demo's sources (the prospect's website, text
 * pasted from its Google listing or Facebook page) have been read, the setup assistant proposes
 * the business details, description, services, greeting and suggested questions, and they are put
 * on the page straight away. Unlike an owner's own setup, nobody reviews the suggestion first: the
 * operator reviews the finished page before sharing its link, and the page is private (demo
 * notice, never listed). The setup assistant's rule still holds: nothing is kept that isn't in the
 * sources.
 */

export interface DemoBuildPayload {
  demoId: string;
}

/** How long to wait for the sources before building with whatever was read. */
export const DEMO_SOURCE_WAIT_MS = 10 * 60 * 1000;

export type DemoBuildOutcome = "waiting" | "ready" | "needs_information" | "failed" | "skipped";

export async function buildDemo(
  deps: SetupDeps & { now?: () => Date },
  tenantId: string,
  payload: DemoBuildPayload,
): Promise<DemoBuildOutcome> {
  const { db } = deps;
  const [demo] = await db.select().from(demos).where(eq(demos.id, payload.demoId)).limit(1);
  const [tenant] = await db.select({ kind: tenants.kind }).from(tenants).where(eq(tenants.id, tenantId));
  // Handed over or removed since the job was queued: an owner's page is never filled in unreviewed.
  if (!demo || demo.tenantId !== tenantId || demo.status !== "building" || tenant?.kind !== "demo") {
    return "skipped";
  }
  const finish = async (status: "ready" | "needs_information" | "failed", error: string | null) => {
    await db.update(demos).set({ status, error }).where(eq(demos.id, demo.id));
    return status;
  };

  const state = await withTenant(db, tenantId, async (tx) => {
    const sources = await tx
      .select({ status: knowledgeSources.status })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.botId, demo.botId));
    const [pages] = await tx.select({ n: count() }).from(documents).where(eq(documents.botId, demo.botId));
    return {
      reading: sources.some((s) => s.status === "pending" || s.status === "processing"),
      pages: pages?.n ?? 0,
    };
  });
  const waited = (deps.now?.() ?? new Date()).getTime() - demo.updatedAt.getTime();
  if (state.reading && waited < DEMO_SOURCE_WAIT_MS) return "waiting";
  if (!state.pages) return finish("needs_information", "no_information");

  const runId = await withTenant(db, tenantId, async (tx) => {
    const [run] = await tx
      .insert(setupRuns)
      .values({ tenantId, botId: demo.botId, createdBy: demo.createdBy })
      .returning({ id: setupRuns.id });
    return run!.id;
  });
  await runSetup(deps, tenantId, runId);

  const applied = await withTenant(db, tenantId, async (tx) => {
    const [run] = await tx.select().from(setupRuns).where(eq(setupRuns.id, runId)).limit(1);
    const [bot] = await tx.select().from(bots).where(eq(bots.id, demo.botId)).limit(1);
    if (!bot) return null;
    // Without a suggestion the page still exists (name, chat over the sources); the operator can
    // build it again.
    if (run?.status !== "ready" || !run.suggestion) return { error: run?.error ?? "setup_failed" };
    await applySetup(tx, { tenantId, bot, input: suggestionToInput(run.suggestion) });
    await tx.update(setupRuns).set({ status: "applied" }).where(eq(setupRuns.id, runId));
    return { error: null };
  });
  if (!applied) return "skipped";
  return applied.error ? finish("failed", applied.error) : finish("ready", null);
}

/** For the queue: a demo build that is still waiting for its sources is tried again shortly. */
export const DEMO_RETRY_MS = 4000;
