/**
 * Phone and SMS behind our own interface (docs/PHONE_AND_SMS.md §3.1): the carrier can be changed
 * without touching the engine, the API routes or the worker.
 */

/** Webhook fields as the provider posted them (form fields, all strings). */
export type WebhookParams = Record<string, string>;

export interface InboundMessage {
  /** The provider's id for the message. */
  id: string;
  /** The customer's number, E.164. */
  from: string;
  /** Our number that was texted, E.164. */
  to: string;
  text: string;
  /** Pictures sent with it (MMS). */
  media: { url: string; contentType: string }[];
}

export interface IncomingCall {
  id: string;
  /** The caller's number, E.164; null when withheld. */
  from: string | null;
  /** Our number that was called, E.164. */
  to: string;
}

export type MessageStatus = "queued" | "sent" | "delivered" | "failed";

export interface MessageStatusUpdate {
  id: string;
  status: MessageStatus;
  /** The provider's error code when it failed (e.g. Twilio 21610: the number opted out). */
  errorCode: string | null;
}

export interface SendMessageInput {
  from: string;
  to: string;
  text: string;
  /** Where the provider reports delivery. */
  statusCallbackUrl?: string;
}

/** What a webhook answers with: a document in the provider's own format. */
export interface WebhookReply {
  contentType: string;
  body: string;
}

export interface TelephonyProvider {
  /** Name stored with numbers and messages ("twilio"). */
  readonly id: string;
  /** The request header that carries the webhook signature (lower case). */
  readonly signatureHeader: string;
  /**
   * True when the request really comes from the provider. `url` is the full public URL the provider
   * called, query string included.
   */
  verifyWebhook(input: { url: string; params: WebhookParams; signature: string | undefined }): boolean;
  parseInboundMessage(params: WebhookParams): InboundMessage | null;
  parseIncomingCall(params: WebhookParams): IncomingCall | null;
  parseMessageStatus(params: WebhookParams): MessageStatusUpdate | null;
  sendMessage(input: SendMessageInput): Promise<{ id: string; status: MessageStatus }>;
  /** Nothing to say back to an inbound text (the reply is sent separately). */
  replyNothing(): WebhookReply;
  /** Answers a call with one spoken sentence, then hangs up. */
  replySayAndHangUp(text: string, language: "en" | "fr"): WebhookReply;
  /** Refuses a call (unknown number, phone answering off). */
  replyReject(): WebhookReply;
}

/** A send the provider refused for good: trying again won't help (bad number, opted out). */
export class PermanentSendError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "PermanentSendError";
  }
}
