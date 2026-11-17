import { applyMessageStatus, handleMissedCall, receiveSms } from "@traiblazer/core";
import { resolvePhoneNumber } from "@traiblazer/db";
import type { WebhookParams, WebhookReply } from "@traiblazer/telephony";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { isUuid } from "../lib/ids.js";
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
    if (message && number) await receiveSms(db, telephony.id, number, message);
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
