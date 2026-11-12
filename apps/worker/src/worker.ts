/**
 * Background worker: polls the Postgres job queue and runs jobs (website crawls, text indexing,
 * reading uploaded price lists and brochures, add-on effects such as notification emails, urgent request alerts, the setup assistant).
 * Several workers can run side by side; jobs are claimed with FOR UPDATE SKIP LOCKED.
 */
import { hostname } from "node:os";
import {
  type AddonEffectPayload,
  buildDemo,
  claimNextJob,
  completeJob,
  DEMO_RETRY_MS,
  type DemoBuildPayload,
  embedChunks,
  enqueueEmbedding,
  enqueueJob,
  failJob,
  JOB_TYPES,
  type JobRow,
  runAddonEffect,
  runSetup,
  runUrgentAlert,
  syncSource,
  type UrgentAlertPayload,
} from "@traiblazer/core";
import { createDb } from "@traiblazer/db";
import { createEmbeddingsFromEnv, createGatewayFromEnv } from "@traiblazer/llm";
import { createMailerFromEnv } from "./mailer.js";

const url =
  process.env.DATABASE_APP_URL ?? "postgres://traiblazer_app:traiblazer_app@localhost:5433/traiblazer";
const { db, close } = createDb(url, { max: 4 });
const embeddings = createEmbeddingsFromEnv();
const { gateway } = createGatewayFromEnv();
const workerId = `${hostname()}:${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1000);

const log = (msg: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...data }));
const mailer = createMailerFromEnv(process.env, log);
/** Most text of a business's pages the setup assistant reads (default in @traiblazer/core). */
const setupInputChars = Number(process.env.SETUP_MAX_INPUT_CHARS) || undefined;
/** Admin portal origin, for links in urgent alerts. */
const adminUrl = process.env.ADMIN_ORIGIN ? new URL(process.env.ADMIN_ORIGIN).origin : undefined;

async function run(job: JobRow): Promise<void> {
  switch (job.type) {
    case JOB_TYPES.sourceSync:
      await syncSource({ db, embeddings, gateway }, job.tenantId, String(job.payload.sourceId));
      return;
    case JOB_TYPES.embedChunks: {
      // Queued only when embeddings are configured; a worker without them leaves keyword search alone.
      if (!embeddings) return;
      const botId = String(job.payload.botId);
      const { embedded, more } = await embedChunks({ db, embeddings }, job.tenantId, botId);
      if (more) await enqueueEmbedding(db, job.tenantId, botId);
      log("embedded", { id: job.id, botId, embedded, more, model: embeddings.model });
      return;
    }
    case JOB_TYPES.addonEffect: {
      const payload = job.payload as unknown as AddonEffectPayload;
      const outcome = await runAddonEffect({ db, mailer }, job.tenantId, payload);
      log("add-on effect", { id: job.id, addonId: payload.addonId, kind: payload.effect.kind, outcome });
      return;
    }
    case JOB_TYPES.urgentAlert: {
      const payload = job.payload as unknown as UrgentAlertPayload;
      const outcome = await runUrgentAlert({ db, mailer, adminUrl }, job.tenantId, payload);
      log("urgent alert", { id: job.id, leadId: payload.leadId, outcome });
      return;
    }
    case JOB_TYPES.demoBuild: {
      const payload = job.payload as unknown as DemoBuildPayload;
      const outcome = await buildDemo(
        { db, gateway, log, inputChars: setupInputChars, embed: Boolean(embeddings) },
        job.tenantId,
        payload,
      );
      // Its sources are still being read: look again shortly.
      if (outcome === "waiting") {
        await enqueueJob(db, {
          tenantId: job.tenantId,
          type: JOB_TYPES.demoBuild,
          payload: { ...payload },
          runAt: new Date(Date.now() + DEMO_RETRY_MS),
        });
      } else log("demo build", { id: job.id, demoId: payload.demoId, outcome });
      return;
    }
    case JOB_TYPES.botSetup:
      await runSetup(
        { db, gateway, log, inputChars: setupInputChars },
        job.tenantId,
        String(job.payload.runId),
      );
      return;
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
