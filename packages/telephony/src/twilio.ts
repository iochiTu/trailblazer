import { createHmac, timingSafeEqual } from "node:crypto";
import { toE164 } from "./numbers.js";
import {
  type InboundMessage,
  type IncomingCall,
  type MessageStatus,
  type MessageStatusUpdate,
  PermanentSendError,
  type SendMessageInput,
  type TelephonyProvider,
  type WebhookParams,
  type WebhookReply,
} from "./types.js";

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  /** Default https://api.twilio.com; replaced in tests. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per request (default 10 s). */
  timeoutMs?: number;
}

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const twiml = (inner: string): WebhookReply => ({
  contentType: "text/xml; charset=utf-8",
  body: `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
});

const STATUS: Record<string, MessageStatus> = {
  accepted: "queued",
  scheduled: "queued",
  queued: "queued",
  sending: "queued",
  sent: "sent",
  delivered: "delivered",
  undelivered: "failed",
  failed: "failed",
};

/** Twilio error codes that won't go away by trying again (bad or blocked number, opted out, not a mobile). */
const PERMANENT = new Set(["21211", "21408", "21610", "21612", "21614", "30003", "30004", "30005", "30006"]);

/**
 * Twilio through its REST API and webhooks, without its SDK: SMS in and out, delivery status, and
 * the first answer to a call.
 */
export class TwilioProvider implements TelephonyProvider {
  readonly id = "twilio";
  readonly signatureHeader = "x-twilio-signature";

  constructor(private readonly options: TwilioOptions) {}

  /**
   * Twilio signs the URL followed by every form field (name then value, sorted by name) with the
   * account's auth token: HMAC-SHA1, base64, in the X-Twilio-Signature header.
   */
  verifyWebhook(input: { url: string; params: WebhookParams; signature: string | undefined }): boolean {
    if (!input.signature) return false;
    const data = Object.keys(input.params)
      .sort()
      .reduce((text, key) => text + key + input.params[key], input.url);
    const expected = createHmac("sha1", this.options.authToken).update(data, "utf8").digest();
    const given = Buffer.from(input.signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  parseInboundMessage(params: WebhookParams): InboundMessage | null {
    const from = toE164(params.From);
    const to = toE164(params.To);
    const id = params.MessageSid ?? params.SmsSid;
    if (!from || !to || !id) return null;
    const count = Math.min(10, Number.parseInt(params.NumMedia ?? "0", 10) || 0);
    const media = [];
    for (let i = 0; i < count; i++) {
      const url = params[`MediaUrl${i}`];
      if (url) media.push({ url, contentType: params[`MediaContentType${i}`] ?? "application/octet-stream" });
    }
    return { id, from, to, text: (params.Body ?? "").trim(), media };
  }

  parseIncomingCall(params: WebhookParams): IncomingCall | null {
    const to = toE164(params.To);
    if (!to || !params.CallSid) return null;
    return { id: params.CallSid, from: toE164(params.From), to };
  }

  parseMessageStatus(params: WebhookParams): MessageStatusUpdate | null {
    const id = params.MessageSid ?? params.SmsSid;
    const status = STATUS[(params.MessageStatus ?? params.SmsStatus ?? "").toLowerCase()];
    if (!id || !status) return null;
    return { id, status, errorCode: params.ErrorCode || null };
  }

  async sendMessage(input: SendMessageInput): Promise<{ id: string; status: MessageStatus }> {
    const { accountSid, authToken } = this.options;
    const body = new URLSearchParams({ From: input.from, To: input.to, Body: input.text });
    if (input.statusCallbackUrl) body.set("StatusCallback", input.statusCallbackUrl);
    const res = await (this.options.fetch ?? fetch)(
      `${(this.options.baseUrl ?? "https://api.twilio.com").replace(/\/$/, "")}/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      code?: number;
      message?: string;
    };
    if (!res.ok || !data.sid) {
      const code = data.code ? String(data.code) : null;
      const message = `Twilio refused the message: ${res.status} ${data.message ?? ""}`.trim();
      // A wrong request (4xx other than rate limiting) fails the same way next time.
      if ((code && PERMANENT.has(code)) || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        throw new PermanentSendError(message, code);
      }
      throw new Error(message);
    }
    return { id: data.sid, status: STATUS[data.status ?? "queued"] ?? "queued" };
  }

  replyNothing(): WebhookReply {
    return twiml("");
  }

  replySayAndHangUp(text: string, language: "en" | "fr"): WebhookReply {
    return twiml(`<Say language="${language === "fr" ? "fr-CA" : "en-CA"}">${xml(text)}</Say><Hangup/>`);
  }

  replyReject(): WebhookReply {
    return twiml("<Reject/>");
  }
}

/** The X-Twilio-Signature a request would carry: for tests and local tools. */
export function twilioSignature(authToken: string, url: string, params: WebhookParams): string {
  const data = Object.keys(params)
    .sort()
    .reduce((text, key) => text + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}
