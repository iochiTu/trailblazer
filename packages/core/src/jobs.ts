import { type Db, jobs } from "@traiblazer/db";
import { and, eq, gt, sql } from "drizzle-orm";
import type { AddonEffectPayload } from "./addons/effects.js";
import type { DemoBuildPayload } from "./demo/build.js";
import { errorMessage } from "./errors.js";
import type { PushNotifyPayload } from "./push/notify.js";
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
  messageReceive: "message.receive",
  /** Sends an email a team member wrote to a contact. */
  contactEmail: "contact.email",
  /** Emails the business that its number's daily spend cap was reached. */
  phoneCapAlert: "phone.cap_alert",
  /** Push notifications to the business's team: a new or urgent request, a note on one (PLAN §20). */
  pushNotify: "push.notify",
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
  [JOB_TYPES.messageReceive]: { receiptId: string };
  [JOB_TYPES.messageSend]: { messageId: string };
  [JOB_TYPES.contactEmail]: { messageId: string };
  [JOB_TYPES.phoneCapAlert]: { botId: string; spentMicros?: number };
  [JOB_TYPES.pushNotify]: PushNotifyPayload;
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

export const JOB_LEASE_MS = 15 * 60_000;

/** Each claim increments attempts, including when the same worker reclaims an expired job. */
export type ClaimedJob = JobRow & { lockedBy: string };
const leaseCutoff = sql`statement_timestamp() - (${JOB_LEASE_MS}::integer * interval '1 millisecond')`;

/** Pick and return one claim atomically. Concurrent pollers skip rows another worker is claiming. */
export async function claimNextJob(db: Db, workerId: string): Promise<ClaimedJob | null> {
  const [job] = await db
    .update(jobs)
    .set({
      status: "running",
      attempts: sql`${jobs.attempts} + 1`,
      lockedAt: sql`statement_timestamp()`,
      lockedBy: workerId,
    })
    .where(
      eq(
        jobs.id,
        sql`(
      select id from jobs
      where (status = 'queued' and run_at <= statement_timestamp())
         or (status = 'running' and locked_at <= ${leaseCutoff})
      order by priority desc, run_at
      for update skip locked
      limit 1
    )`,
      ),
    )
    .returning();
  return job ? { ...job, lockedBy: workerId } : null;
}

function currentLease(job: ClaimedJob) {
  return and(
    eq(jobs.id, job.id),
    eq(jobs.status, "running"),
    eq(jobs.lockedBy, job.lockedBy),
    eq(jobs.attempts, job.attempts),
    gt(jobs.lockedAt, leaseCutoff),
  );
}

/** False means the claim expired, was replaced, or has already finished. */
export async function renewJobLease(db: Db, job: ClaimedJob): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ lockedAt: sql`statement_timestamp()` })
    .where(currentLease(job))
    .returning({ id: jobs.id });
  return rows.length === 1;
}

export async function completeJob(db: Db, job: ClaimedJob): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: "done", lockedAt: null, lockedBy: null, lastError: null })
    .where(currentLease(job))
    .returning({ id: jobs.id });
  return rows.length === 1;
}

/** Retries with exponential backoff (30 s, 60 s, 120 s …) until max attempts. */
export async function failJob(db: Db, job: ClaimedJob, error: unknown): Promise<"retry" | "failed" | "lost"> {
  const retry = job.attempts < job.maxAttempts;
  const rows = await db
    .update(jobs)
    .set({
      status: retry ? "queued" : "failed",
      lockedAt: null,
      lockedBy: null,
      lastError: errorMessage(error).slice(0, 2000),
      ...(retry ? { runAt: new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1)) } : {}),
    })
    .where(currentLease(job))
    .returning({ id: jobs.id });
  if (!rows.length) return "lost";
  return retry ? "retry" : "failed";
}
