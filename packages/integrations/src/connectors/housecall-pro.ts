import { requestJson } from "../http.js";
import { leadNotes, phoneDigits, splitName } from "../lead-text.js";
import { type ConnectorContext, ConnectorError, type CrmConnector } from "../types.js";

/**
 * Housecall Pro (https://docs.housecallpro.com): a company API key, sent as
 * `Authorization: Token <key>`. Keys exist on the MAX plan only and are made by an admin under
 * My Apps → API Key Management (full access is needed to create leads).
 *
 * A request from a visitor becomes a Housecall Pro *lead* (POST /leads), which lands in the Job
 * Inbox under "API Leads" once the owner turns that channel on. An existing customer with the
 * same email or phone is reused; otherwise the lead creates the customer.
 */

const BASE_URL = "https://api.housecallpro.com";
const SOURCE = "Traiblazer assistant";

const call = <T>(ctx: ConnectorContext, path: string, json?: unknown) => {
  if (!ctx.credentials.apiKey) throw new ConnectorError("auth", "No Housecall Pro API key is set");
  return requestJson<T>(ctx.fetch, "Housecall Pro", `${BASE_URL}${path}`, {
    headers: { authorization: `Token ${ctx.credentials.apiKey}` },
    json,
  });
};

interface Customer {
  id: string;
  email?: string | null;
  mobile_number?: string | null;
  home_number?: string | null;
  work_number?: string | null;
}

const samePhone = (a: string | null | undefined, b: string) =>
  !!a && phoneDigits(a).replace(/^\+?1(?=\d{10}$)/, "") === b;

/** An existing customer with exactly this email or phone (`q` alone also matches names and addresses). */
async function findCustomer(ctx: ConnectorContext, email: string | null, phone: string | null) {
  const wanted = phone ? phoneDigits(phone).replace(/^\+?1(?=\d{10}$)/, "") : null;
  for (const term of [email, phone]) {
    if (!term) continue;
    const res = await call<{ customers?: Customer[] }>(
      ctx,
      `/customers?${new URLSearchParams({ q: term, page_size: "10" })}`,
    );
    const match = res?.customers?.find(
      (c) =>
        (email && c.email?.toLowerCase() === email.toLowerCase()) ||
        (wanted && [c.mobile_number, c.home_number, c.work_number].some((n) => samePhone(n, wanted))),
    );
    if (match) return match.id;
  }
  return null;
}

export const housecallPro: CrmConnector = {
  id: "housecall-pro",
  name: "Housecall Pro",
  auth: "fields",
  fields: [
    {
      key: "apiKey",
      label: { en: "API key", fr: "Clé API" },
      hint: {
        en: "In Housecall Pro (MAX plan): My Apps, then API Key Management, then Generate API Key with full access. Also turn on API Leads under My Apps, Job Inbox.",
        fr: "Dans Housecall Pro (forfait MAX) : My Apps, puis API Key Management, puis Generate API Key avec accès complet. Activez aussi API Leads sous My Apps, Job Inbox.",
      },
      secret: true,
      required: true,
      maxLength: 200,
    },
  ],
  ready: () => true,

  async verify(ctx) {
    const company = await call<{ name?: string }>(ctx, "/company");
    return { accountName: company?.name ?? null };
  },

  async pushLead(ctx, lead) {
    const customerId = await findCustomer(ctx, lead.email, lead.phone);
    const { first, last } = splitName(lead.name);
    const created = await call<{ id?: string }>(ctx, "/leads", {
      ...(customerId
        ? { customer_id: customerId }
        : {
            customer: {
              first_name: first,
              last_name: last,
              ...(lead.email ? { email: lead.email } : {}),
              ...(lead.phone ? { mobile_number: lead.phone } : {}),
              notifications_enabled: false,
              lead_source: SOURCE,
            },
          }),
      lead_source: SOURCE,
      note: leadNotes(lead),
      ...(lead.urgent ? { tags: ["Urgent"] } : {}),
    });
    // Housecall Pro has no stable public address for a lead: staff find it in the Job Inbox.
    return { externalId: created?.id ?? null, externalUrl: null };
  },
};
