import { hmacHex } from "../crypto.js";
import { unreachable } from "../http.js";
import { leadNotes, leadTitle } from "../lead-text.js";
import { type ConnectorContext, ConnectorError, type CrmConnector, type CrmLead } from "../types.js";

/**
 * Webhook: posts each request as JSON to an address the business gives. It reaches any CRM that
 * has no connector yet through Zapier, Make, n8n or Power Automate (HubSpot, Salesforce, Zoho,
 * Pipedrive, Monday, a spreadsheet…), and custom systems directly.
 *
 * When a signing secret is set, every call carries `X-Traiblazer-Signature: sha256=<hex>`, the
 * HMAC-SHA256 of `<timestamp>.<body>` with that secret (timestamp in `X-Traiblazer-Timestamp`),
 * so the receiver can check the call is ours and recent.
 */

/** Bumped when the payload changes shape in a way a receiver would notice. */
export const WEBHOOK_PAYLOAD_VERSION = 1;

export function webhookPayload(event: "request.created" | "ping", lead: CrmLead | null, now: Date) {
  return {
    version: WEBHOOK_PAYLOAD_VERSION,
    event,
    sentAt: now.toISOString(),
    request: lead && {
      id: lead.id,
      kind: lead.kind,
      urgent: lead.urgent,
      title: leadTitle(lead),
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      bestTime: lead.bestTime,
      message: lead.message,
      language: lead.language,
      details: Object.fromEntries(lead.details.map((d) => [d.key, d.value])),
      detailLabels: Object.fromEntries(lead.details.map((d) => [d.key, d.label])),
      notes: leadNotes(lead),
      photoCount: lead.photoCount,
      createdAt: lead.createdAt.toISOString(),
      url: lead.requestUrl,
      business: lead.businessName,
    },
  };
}

async function post(ctx: ConnectorContext, payload: unknown): Promise<void> {
  const { url, secret } = ctx.credentials;
  if (!url) throw new ConnectorError("auth", "No webhook address is set");
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor((ctx.now?.() ?? new Date()).getTime() / 1000));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Traiblazer-Webhook/1",
    "x-traiblazer-timestamp": timestamp,
  };
  if (secret) headers["x-traiblazer-signature"] = `sha256=${hmacHex(secret, `${timestamp}.${body}`)}`;

  // The body is signed exactly as sent, so it is serialised here rather than by requestJson.
  let res: Response;
  try {
    res = await ctx.fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw unreachable("The webhook address", error);
  }
  await res.body?.cancel().catch(() => {});
  if (res.ok) return;
  // 404/410: the hook was deleted or turned off (Zapier and Make answer 410): the owner must fix it.
  const gone = [401, 403, 404, 410].includes(res.status);
  const passing = res.status === 408 || res.status === 429 || res.status >= 500;
  throw new ConnectorError(
    gone ? "auth" : passing ? "temporary" : "rejected",
    `The webhook address answered ${res.status}`,
    res.status,
  );
}

export const webhook: CrmConnector = {
  id: "webhook",
  name: "Webhook",
  auth: "fields",
  fields: [
    {
      key: "url",
      label: { en: "Webhook address", fr: "Adresse du webhook" },
      hint: {
        en: "From Zapier (Webhooks by Zapier, Catch Hook), Make, n8n or your own system. Must start with https://.",
        fr: "De Zapier (Webhooks by Zapier, Catch Hook), Make, n8n ou votre propre système. Doit commencer par https://.",
      },
      secret: true,
      required: true,
      placeholder: "https://hooks.zapier.com/hooks/catch/…",
      maxLength: 2048,
    },
    {
      key: "secret",
      label: { en: "Signing secret (optional)", fr: "Secret de signature (facultatif)" },
      hint: {
        en: "If set, each call is signed so your system can check it comes from us.",
        fr: "S'il est défini, chaque appel est signé pour que votre système vérifie qu'il vient de nous.",
      },
      secret: true,
      required: false,
      maxLength: 200,
    },
  ],
  ready: () => true,

  async verify(ctx) {
    let url: URL;
    try {
      url = new URL(ctx.credentials.url ?? "");
    } catch {
      throw new ConnectorError("rejected", "The webhook address is not a valid web address");
    }
    if (url.protocol !== "https:") {
      throw new ConnectorError("rejected", "The webhook address must start with https://");
    }
    await post(ctx, webhookPayload("ping", null, ctx.now?.() ?? new Date()));
    return { accountName: url.hostname };
  },

  async pushLead(ctx, lead) {
    await post(ctx, webhookPayload("request.created", lead, ctx.now?.() ?? new Date()));
    return { externalId: null, externalUrl: null };
  },
};
