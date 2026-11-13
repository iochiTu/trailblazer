import { applyMessageStatus, handleInboundText, handleMissedCall } from "@traiblazer/core";
import { resolvePhoneNumber } from "@traiblazer/db";
import type { WebhookParams, WebhookReply } from "@traiblazer/telephony";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { admitQuestion } from "../lib/chat-guard.js";
import { isUuid } from "../lib/ids.js";

/** Answers still being written after their webhook was acknowledged (tests wait for these). */
const inFlight = new Set<Promise<unknown>>();
export const telephonyIdle = () => Promise.allSettled([...inFlight]);

/** Provider message ids seen lately: a webhook delivered twice is answered once. */
const SEEN_MS = 10 * 60_000;
const seen = new Map<string, number>();
function firstTime(id: string, now = Date.now()): boolean {
  for (const [key, at] of seen) {
    if (now - at > SEEN_MS) seen.delete(key);
    else break;
  }
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
}

/**
 * Webhooks the telephony provider calls (docs/PHONE_AND_SMS.md §4):
 *
 *   POST /v1/telephony/:provider/sms      a text to one of our numbers
 *   POST /v1/telephony/:provider/voice    a call to one of our numbers
 *   POST /v1/telephony/:provider/status   delivery report for a text we sent (?t=tenant&m=message)
 *
 * Every request must carry the provider's signature. The routes exist only when a provider is
 * configured (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN).
 */
export async function telephonyRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const telephony = ctx.telephony;
  if (!telephony) return;

  // Providers post form fields, not JSON.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 64 * 1024 },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  const base = `/v1/telephony/${telephony.id}`;
  // The provider's own traffic comes from few addresses: the per-address limit is for people.
  const options = { config: { rateLimit: { max: 3000, timeWindow: "1 minute" } } };
  const publicUrl = (config.TELEPHONY_WEBHOOK_URL ?? config.PUBLIC_URL).replace(/\/$/, "");

  /** The form fields of a request that really comes from the provider, or null. */
  const verified = (request: FastifyRequest): WebhookParams | null => {
    const params = (request.body ?? {}) as WebhookParams;
    const header = request.headers[telephony.signatureHeader];
    const signature = Array.isArray(header) ? header[0] : header;
    return telephony.verifyWebhook({ url: publicUrl + request.url, params, signature }) ? params : null;
  };
  const send = (reply: FastifyReply, answer: WebhookReply) =>
    reply.header("content-type", answer.contentType).send(answer.body);
  const refuse = (reply: FastifyReply) =>
    reply.code(403).send({ error: "forbidden", message: "Bad signature" });

  app.post(`${base}/sms`, options, async (request, reply) => {
    const params = verified(request);
    if (!params) return refuse(reply);
    const message = telephony.parseInboundMessage(params);
    const number = message && (await resolvePhoneNumber(db, message.to));
    // Unknown number, texting turned off, or a repeat of a webhook already handled: nothing to say.
    if (!message || !number?.smsEnabled || !firstTime(message.id))
      return send(reply, telephony.replyNothing());

    // Answered after the webhook is acknowledged: the provider waits only a few seconds.
    const work = (async () => {
      const admission = await admitQuestion(
        {
          db,
          limiter: ctx.limiter!,
          platform: ctx.platform!,
          // A text thread has no end, so the per-conversation cap of the web chat doesn't apply.
          maxConversationQuestions: Number.MAX_SAFE_INTEGER,
        },
        { tenantId: number.tenantId, visitorId: message.from, conversationId: null },
      );
      if (!admission.ok) {
        request.log.warn({ reason: admission.reason, tenantId: number.tenantId }, "sms not answered");
        return;
      }
      try {
        const outcome = await handleInboundText(
          {
            db,
            gateway: ctx.gateway,
            embeddings: ctx.embeddings,
            embeddingWaitMs: config.EMBEDDINGS_QUERY_WAIT_MS,
            log: (msg, data) => request.log.error(data, msg),
            adminUrl: config.ADMIN_ORIGIN.replace(/\/$/, ""),
          },
          { tenantId: number.tenantId, botId: number.botId, e164: message.to },
          { from: message.from, text: message.text, hasMedia: message.media.length > 0 },
        );
        request.log.info({ outcome, tenantId: number.tenantId, botId: number.botId }, "sms handled");
      } catch (error) {
        request.log.error(error, "sms handling failed");
      } finally {
        await admission.release();
      }
    })();
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
    return send(reply, telephony.replyNothing());
  });

  app.post(`${base}/voice`, options, async (request, reply) => {
    const params = verified(request);
    if (!params) return refuse(reply);
    const call = telephony.parseIncomingCall(params);
    const number = call && (await resolvePhoneNumber(db, call.to));
    if (!call || !number || number.callMode !== "text_back") return send(reply, telephony.replyReject());
    const result = await handleMissedCall(
      { db },
      { tenantId: number.tenantId, botId: number.botId, e164: call.to },
      { from: call.from },
    );
    if (!result) return send(reply, telephony.replyReject());
    request.log.info(
      { texted: result.texted, tenantId: number.tenantId, botId: number.botId },
      "call handled",
    );
    return send(reply, telephony.replySayAndHangUp(result.say, result.language));
  });

  app.post<{ Querystring: { t?: string; m?: string } }>(`${base}/status`, options, async (request, reply) => {
    const params = verified(request);
    if (!params) return refuse(reply);
    const update = telephony.parseMessageStatus(params);
    const { t, m } = request.query;
    if (update && t && m && isUuid(t) && isUuid(m)) await applyMessageStatus(db, t, m, update);
    return reply.code(204).send();
  });
}
