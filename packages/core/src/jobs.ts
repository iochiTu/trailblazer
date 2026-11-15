import { type Db, jobs } from "@traiblazer/db";
import { eq, sql } from "drizzle-orm";
import type { AddonEffectPayload } from "./addons/effects.js";
import type { DemoBuildPayload } from "./demo/build.js";
import { errorMessage } from "./errors.js";
import type { UrgentAlertPayload } from "./requests/urgent-alert.js";

export type JobRow = typeof jobs.$inferSelect;

export const JOB_TYPES = {
  /** Insights: tags one finished conversation and adds it to the day totals. */
  insightsAnalyze: "insights.analyze",
  sourceSync: "source.sync",
  /** Work an add-on asked for during a chat. */
  addonEffect: "addon.effect",
  /** The setup assistant reads a business's information. */
  botSetup: "bot.setup",
  /** Emails the business about an urgent request right away. */
  urgentAlert: "request.urgent_alert",
  /** Fills a prospect demo page in once its sources are read. */
  demoBuild: "demo.build",
  /** Gives an assistant's chunks vectors for search by meaning. */
  embedChunks: "embed.chunks",
  /** Sends one queued text message through the telephony provider. */
  messageSend: "message.send",
  /** Emails the business that its number's daily spend cap was reached. */
  phoneCapAlert: "phone.cap_alert",
} as const;

/** Job priorities: higher runs first. */
export const JOB_PRIORITY = { normal: 0, urgent: 10 } as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

/** What each job carries: checked where it is queued and where the worker runs it. */
export interface JobPayloads {
  [JOB_TYPES.insightsAnalyze]: { conversationId: string };
  [JOB_TYPES.sourceSync]: { sourceId: string };
  [JOB_TYPES.addonEffect]: AddonEffectPayload;
  [JOB_TYPES.botSetup]: { runId: string };
  [JOB_TYPES.urgentAlert]: UrgentAlertPayload;
  [JOB_TYPES.demoBuild]: DemoBuildPayload;
  [JOB_TYPES.embedChunks]: { botId: string };
  [JOB_TYPES.messageSend]: { messageId: string };
  [JOB_TYPES.phoneCapAlert]: { botId: string; spentMicros?: number };
}

export interface NewJob<T extends JobType> {
  tenantId: string;
  type: T;
  payload: JobPayloads[T];
  runAt?: Date;
  priority?: number;
}

/** A row for the job queue, for `insert(jobs)` inside a transaction (`enqueueJob` outside one). */
export function newJob<T extends JobType>(job: NewJob<T>): typeof jobs.$inferInsert {
  return {
    tenantId: job.tenantId,
    type: job.type,
    payload: job.payload as Record<string, unknown>,
    runAt: job.runAt ?? new Date(),
    priority: job.priority ?? JOB_PRIORITY.normal,
  };
}

export async function enqueueJob<T extends JobType>(db: Db, job: NewJob<T>): Promise<string> {
  const [row] = await db.insert(jobs).values(newJob(job)).returning({ id: jobs.id });
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
  const message = errorMessage(error);
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
