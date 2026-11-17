/**
 * Background worker: polls the Postgres job queue and runs jobs (website crawls, text indexing,
 * reading uploaded price lists and brochures, add-on effects such as notification emails, urgent request alerts, push notifications, the setup assistant, Insights).
 * Several workers can run side by side; jobs are claimed with FOR UPDATE SKIP LOCKED.
 */
import { hostname } from "node:os";
import {
  analyzeConversation,
  buildDemo,
  type ClaimedJob,
  claimNextJob,
  completeJob,
  createLimiterStore,
  DEMO_RETRY_MS,
  embedChunks,
  enqueueEmbedding,
  enqueueJob,
  errorMessage,
  failJob,
  JOB_LEASE_MS,
  JOB_TYPES,
  type JobPayloads,
  type JobRow,
  type JobType,
  PlatformConfig,
  processInboundSms,
  renewJobLease,
  runAddonEffect,
  runCapAlert,
  runContactEmail,
  runPushNotify,
  runSetup,
  runUrgentAlert,
  sendQueuedText,
  syncSource,
} from "@traiblazer/core";
import { createDb } from "@traiblazer/db";
import { loadIntegrationsConfig } from "@traiblazer/integrations";
import { createEmbeddingsFromEnv, createGatewayFromEnv, QueryEmbedder } from "@traiblazer/llm";
import { createPushFromEnv } from "@traiblazer/push";
import { createTelephonyFromEnv } from "@traiblazer/telephony";
import { withLeaseRenewal } from "./heartbeat.js";
import { createMailerFromEnv } from "./mailer.js";

const url =
  process.env.DATABASE_APP_URL ?? "postgres://traiblazer_app:traiblazer_app@localhost:5433/traiblazer";
const { db, close } = createDb(url, { max: 4 });
const embeddings = createEmbeddingsFromEnv();
// Phone and SMS (docs/PHONE_AND_SMS.md): texts are sent from here, with retries.
const telephony = createTelephonyFromEnv();
const webhookBase = (process.env.TELEPHONY_WEBHOOK_URL ?? process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
const statusCallbackUrl = webhookBase.startsWith("https://")
  ? (tenantId: string, messageId: string) =>
      `${webhookBase}/v1/telephony/${telephony?.id}/status?t=${tenantId}&m=${messageId}`
  : undefined;
/** What one message part costs us, in millionths of a dollar (default 0.83 cents). */
const segmentCostMicros = Number(process.env.SMS_SEGMENT_COST_MICROS) || 8300;
const { gateway } = createGatewayFromEnv();
const { redis, limiter } = createLimiterStore(process.env.REDIS_URL);
const platform = new PlatformConfig(db);
const queryEmbeddings = embeddings ? new QueryEmbedder(embeddings) : null;
const workerId = `${hostname()}:${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1000);

const log = (msg: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...data }));
const mailer = createMailerFromEnv(process.env, log);
/** Most text of a business's pages the setup assistant reads (default in @traiblazer/core). */
const setupInputChars = Number(process.env.SETUP_MAX_INPUT_CHARS) || undefined;
/** Admin portal origin, for links in urgent alerts. */
const adminUrl = process.env.ADMIN_ORIGIN ? new URL(process.env.ADMIN_ORIGIN).origin : undefined;
/** Push notifications to the owner app and browsers (PLAN §20); each provider is optional. */
const push = createPushFromEnv(process.env);
/** CRM connections (Jobber, ServiceTitan…): off without INTEGRATIONS_SECRET_KEY. */
const integrations = loadIntegrationsConfig(process.env);

/** What the worker does for each job type; a new type doesn't compile until it has a handler here. */
const handlers: { [T in JobType]: (job: JobRow, payload: JobPayloads[T]) => Promise<void> } = {
  [JOB_TYPES.sourceSync]: async (job, { sourceId }) => {
    await syncSource({ db, embeddings, gateway }, job.tenantId, sourceId);
  },
  [JOB_TYPES.messageReceive]: async (job, { receiptId }) => {
    if (!telephony) throw new Error("Inbound SMS is queued but no telephony provider is configured");
    await processInboundSms(
      {
        db,
        gateway,
        telephony,
        embeddings: queryEmbeddings,
        embeddingWaitMs: Number(process.env.EMBEDDINGS_QUERY_WAIT_MS ?? 250),
        platform,
        limiter,
        adminUrl,
        integrations,
        log,
      },
      job.tenantId,
      receiptId,
    );
  },
  [JOB_TYPES.messageSend]: async (job, { messageId }) => {
    if (!telephony) throw new Error("A text is queued but no telephony provider is configured");
    const outcome = await sendQueuedText(
      { db, telephony, statusCallbackUrl, segmentCostMicros },
      job.tenantId,
      messageId,
    );
    log("text", { id: job.id, messageId, outcome });
  },
  [JOB_TYPES.contactEmail]: async (job, payload) => {
    const outcome = await runContactEmail(
      { db, mailer, mailConfigured: !!process.env.SMTP_URL },
      job.tenantId,
      payload,
      job.attempts >= job.maxAttempts,
    );
    log("contact email", { id: job.id, messageId: payload.messageId, outcome });
  },
  [JOB_TYPES.phoneCapAlert]: async (job, payload) => {
    const outcome = await runCapAlert({ db, mailer, adminUrl }, job.tenantId, payload);
    log("cap alert", { id: job.id, outcome });
  },
  [JOB_TYPES.embedChunks]: async (job, { botId }) => {
    // Queued only when embeddings are configured; a worker without them leaves keyword search alone.
    if (!embeddings) return;
    const { embedded, more } = await embedChunks({ db, embeddings }, job.tenantId, botId);
    if (more) await enqueueEmbedding(db, job.tenantId, botId);
    log("embedded", { id: job.id, botId, embedded, more, model: embeddings.model });
  },
  [JOB_TYPES.addonEffect]: async (job, payload) => {
    const outcome = await runAddonEffect({ db, mailer, integrations, adminUrl }, job.tenantId, payload);
    log("add-on effect", { id: job.id, addonId: payload.addonId, kind: payload.effect.kind, outcome });
  },
  [JOB_TYPES.urgentAlert]: async (job, payload) => {
    const outcome = await runUrgentAlert({ db, mailer, adminUrl }, job.tenantId, payload);
    log("urgent alert", { id: job.id, leadId: payload.leadId, outcome });
  },
  [JOB_TYPES.pushNotify]: async (job, payload) => {
    const outcome = await runPushNotify({ db, push }, job.tenantId, payload);
    log("push", { id: job.id, event: payload.event, leadId: payload.leadId, outcome });
  },
  [JOB_TYPES.demoBuild]: async (job, payload) => {
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
  },
  [JOB_TYPES.insightsAnalyze]: async (job, { conversationId }) => {
    const outcome = await analyzeConversation(
      { db, gateway, log },
      { tenantId: job.tenantId, conversationId },
    );
    log("insights", { id: job.id, conversationId, outcome });
  },
  [JOB_TYPES.botSetup]: async (job, { runId }) => {
    await runSetup({ db, gateway, log, inputChars: setupInputChars }, job.tenantId, runId);
  },
};

async function run(job: JobRow): Promise<void> {
  // The queue stores the type as text: a row written by a newer release may be unknown here.
  const handler = Object.hasOwn(handlers, job.type) ? handlers[job.type as JobType] : undefined;
  if (!handler) throw new Error(`Unknown job type: ${job.type}`);
  // The payload was checked against its type where the job was queued (`newJob`).
  await handler(job, job.payload as never);
}

async function runClaim(job: ClaimedJob): Promise<void> {
  const started = Date.now();
  try {
    await withLeaseRenewal(
      () => run(job),
      () => renewJobLease(db, job),
      JOB_LEASE_MS / 3,
      (error) => log("job renewal failed", { id: job.id, error: errorMessage(error) }),
    );
  } catch (error) {
    const outcome = await failJob(db, job, error);
    log(outcome === "lost" ? "job lease lost" : "job failed", {
      id: job.id,
      type: job.type,
      outcome,
      error: errorMessage(error),
    });
    return;
  }
  const completed = await completeJob(db, job);
  log(completed ? "job done" : "job lease lost", { id: job.id, type: job.type, ms: Date.now() - started });
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    log("stopping after current job", { signal });
  });
}

log("worker started", {
  workerId,
  embeddings: embeddings?.model ?? null,
  smtp: !!process.env.SMTP_URL,
  integrations: !!integrations.secretKey,
  push: push.platforms,
});
while (!stopping) {
  let job: ClaimedJob | null = null;
  try {
    job = await claimNextJob(db, workerId);
  } catch (error) {
    log("claim failed", { error: String(error) });
  }
  if (!job) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    continue;
  }
  try {
    await runClaim(job);
  } catch (error) {
    log("job status update failed", { id: job.id, error: errorMessage(error) });
  }
}
redis?.disconnect();
await close();
