import { type Db, jobs } from "@traiblazer/db";
import { eq, sql } from "drizzle-orm";

export type JobRow = typeof jobs.$inferSelect;

export const JOB_TYPES = {
  sourceSync: "source.sync",
  /** Work an add-on asked for during a chat (payload: { botId, addonId, effect }). */
  addonEffect: "addon.effect",
  /** The setup assistant reads a business's information (payload: { runId }). */
  botSetup: "bot.setup",
  /** Emails the business about an urgent request right away (payload: { botId, leadId }). */
  urgentAlert: "request.urgent_alert",
  /** Fills a prospect demo page in once its sources are read (payload: { demoId }). */
  demoBuild: "demo.build",
} as const;

/** Job priorities: higher runs first. */
export const JOB_PRIORITY = { normal: 0, urgent: 10 } as const;

export async function enqueueJob(
  db: Db,
  job: { tenantId: string; type: string; payload: Record<string, unknown>; runAt?: Date; priority?: number },
): Promise<string> {
  const [row] = await db
    .insert(jobs)
    .values({
      tenantId: job.tenantId,
      type: job.type,
      payload: job.payload,
      runAt: job.runAt ?? new Date(),
      priority: job.priority ?? JOB_PRIORITY.normal,
    })
    .returning({ id: jobs.id });
  return row!.id;
}

/**
 * Atomically claims the next runnable job, highest priority first. `SKIP LOCKED` lets several workers poll safely; jobs
 * stuck in "running" for 15 minutes (crashed worker) are picked up again.
 */
export async function claimNextJob(db: Db, workerId: string): Promise<JobRow | null> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    update jobs
       set status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = ${workerId}, updated_at = now()
     where id = (
       select id from jobs
        where (status = 'queued' and run_at <= now())
           or (status = 'running' and locked_at < now() - interval '15 minutes')
        order by priority desc, run_at
        for update skip locked
        limit 1)
    returning id`);
  const id = rows[0]?.id as string | undefined;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return job ?? null;
}

export async function completeJob(db: Db, id: string): Promise<void> {
  await db.update(jobs).set({ status: "done", lockedAt: null, lastError: null }).where(eq(jobs.id, id));
}

/** Retries with exponential backoff (30 s, 60 s, 120 s …) until max attempts, then marks failed. */
export async function failJob(db: Db, job: JobRow, error: unknown): Promise<"retry" | "failed"> {
  const message = error instanceof Error ? error.message : String(error);
  if (job.attempts < job.maxAttempts) {
    await db
      .update(jobs)
      .set({
        status: "queued",
        lockedAt: null,
        lastError: message.slice(0, 2000),
        runAt: new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1)),
      })
      .where(eq(jobs.id, job.id));
    return "retry";
  }
  await db
    .update(jobs)
    .set({ status: "failed", lockedAt: null, lastError: message.slice(0, 2000) })
    .where(eq(jobs.id, job.id));
  return "failed";
}
