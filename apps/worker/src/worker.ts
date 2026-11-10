/**
 * Background worker: polls the Postgres job queue and runs jobs (website crawls, text indexing,
 * add-on effects such as notification emails).
 * Several workers can run side by side; jobs are claimed with FOR UPDATE SKIP LOCKED.
 */
import { hostname } from "node:os";
import {
  type AddonEffectPayload,
  claimNextJob,
  completeJob,
  failJob,
  JOB_TYPES,
  type JobRow,
  runAddonEffect,
  syncSource,
} from "@traiblazer/core";
import { createDb } from "@traiblazer/db";
import { createEmbeddingsFromEnv } from "@traiblazer/llm";
import { createMailerFromEnv } from "./mailer.js";

const url =
  process.env.DATABASE_APP_URL ?? "postgres://traiblazer_app:traiblazer_app@localhost:5433/traiblazer";
const { db, close } = createDb(url, { max: 4 });
const embeddings = createEmbeddingsFromEnv();
const workerId = `${hostname()}:${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1000);

const log = (msg: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...data }));
const mailer = createMailerFromEnv(process.env, log);

async function run(job: JobRow): Promise<void> {
  switch (job.type) {
    case JOB_TYPES.sourceSync:
      await syncSource({ db, embeddings }, job.tenantId, String(job.payload.sourceId));
      return;
    case JOB_TYPES.addonEffect: {
      const payload = job.payload as unknown as AddonEffectPayload;
      const outcome = await runAddonEffect({ db, mailer }, job.tenantId, payload);
      log("add-on effect", { id: job.id, addonId: payload.addonId, kind: payload.effect.kind, outcome });
      return;
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    log("stopping after current job", { signal });
  });
}

log("worker started", { workerId, embeddings: embeddings?.model ?? null, smtp: !!process.env.SMTP_URL });
while (!stopping) {
  let job: JobRow | null = null;
  try {
    job = await claimNextJob(db, workerId);
  } catch (error) {
    log("claim failed", { error: String(error) });
  }
  if (!job) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    continue;
  }
  const started = Date.now();
  try {
    await run(job);
    await completeJob(db, job.id);
    log("job done", { id: job.id, type: job.type, ms: Date.now() - started });
  } catch (error) {
    const outcome = await failJob(db, job, error);
    log("job failed", {
      id: job.id,
      type: job.type,
      outcome,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
await close();
