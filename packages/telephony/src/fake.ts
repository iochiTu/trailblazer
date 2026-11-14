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

/**
 * A provider for tests and local development: keeps what was sent, accepts webhooks signed with
 * "valid", and uses plain field names (from, to, text, id, status).
 */
export class FakeTelephony implements TelephonyProvider {
  readonly id = "fake";
  readonly signatureHeader = "x-fake-signature";
  sent: SendMessageInput[] = [];
  /** Pictures a test "sends": the url in a webhook's `media` field, and what it downloads as. */
  media = new Map<string, { bytes: Buffer; contentType: string }>();
  /** Set to make the next sends fail: "permanent" (never retried) or "temporary". */
  failing: "permanent" | "temporary" | null = null;

  verifyWebhook(input: { signature: string | undefined }): boolean {
    return input.signature === "valid";
  }
  parseInboundMessage(params: WebhookParams): InboundMessage | null {
    const from = toE164(params.from);
    const to = toE164(params.to);
    if (!from || !to) return null;
    return {
      id: params.id ?? `in_${crypto.randomUUID()}`,
      from,
      to,
      text: (params.text ?? "").trim(),
      media: (params.media ?? "")
        .split(",")
        .filter(Boolean)
        .map((url) => ({ url, contentType: this.media.get(url)?.contentType ?? "application/octet-stream" })),
    };
  }
  parseIncomingCall(params: WebhookParams): IncomingCall | null {
    const to = toE164(params.to);
    return to ? { id: params.id ?? `call_${crypto.randomUUID()}`, from: toE164(params.from), to } : null;
  }
  parseMessageStatus(params: WebhookParams): MessageStatusUpdate | null {
    if (!params.id || !params.status) return null;
    return { id: params.id, status: params.status as MessageStatus, errorCode: params.errorCode ?? null };
  }
  async sendMessage(input: SendMessageInput): Promise<{ id: string; status: MessageStatus }> {
    if (this.failing === "permanent") throw new PermanentSendError("Not a mobile number", "30006");
    if (this.failing === "temporary") throw new Error("Provider unavailable");
    this.sent.push(input);
    return { id: `out_${this.sent.length}`, status: "queued" };
  }
  async fetchMedia(url: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string } | null> {
    const found = this.media.get(url);
    return found && found.bytes.length <= maxBytes ? found : null;
  }
  replyNothing(): WebhookReply {
    return { contentType: "text/plain", body: "" };
  }
  replySayAndHangUp(text: string, language: "en" | "fr"): WebhookReply {
    return { contentType: "text/plain", body: `say(${language}): ${text}` };
  }
  replyReject(): WebhookReply {
    return { contentType: "text/plain", body: "reject" };
  }
}
