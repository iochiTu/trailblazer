/**
 * Integrations: connectors for the software businesses already run on (CRMs: Jobber, Housecall Pro,
 * ServiceTitan, and anything else through a webhook; calendars: Google Calendar), plus the sealing
 * of their credentials.
 * See types.ts for the connector contract and registry.ts for the list.
 */
export { GOOGLE_CALENDAR_SCOPES, googleEventId } from "./connectors/google-calendar.js";
export { JOBBER_API_VERSION } from "./connectors/jobber.js";
export { WEBHOOK_PAYLOAD_VERSION, webhookPayload } from "./connectors/webhook.js";
export { hmacHex, open, parseSecretKey, readToken, seal, signToken } from "./crypto.js";
export { leadNotes, leadTitle, phoneDigits, splitName } from "./lead-text.js";
export * from "./registry.js";
export * from "./types.js";
