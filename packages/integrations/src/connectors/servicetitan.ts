import { requestJson } from "../http.js";
import { leadNotes, phoneDigits } from "../lead-text.js";
import {
  type ConnectorContext,
  ConnectorError,
  type Credentials,
  type CrmConnector,
  type PlatformKeys,
} from "../types.js";

/**
 * ServiceTitan (https://developer.servicetitan.io): OAuth 2.0 client credentials.
 *
 * Who holds what: the *app key* is ours, one per environment, issued once ServiceTitan accepts us
 * into its partner program (SERVICETITAN_APP_KEY). Each business gives its tenant ID and the
 * client ID and secret its admin generates under Settings → Integrations → API Application
 * Access when connecting our app.
 *
 * A request from a visitor becomes a ServiceTitan *booking* (the route ServiceTitan gives outside
 * lead sources): it shows on the office's Bookings screen for a CSR to confirm and turn into a
 * job. Bookings belong to a "booking provider tag" the business creates under Settings →
 * Integrations → Booking Provider Tags; when the owner doesn't give its ID we use the business's
 * first tag.
 *
 * Access tokens last 15 minutes and asking for new ones is throttled, so the token is kept with
 * the (sealed) credentials and reused until it is about to run out.
 *
 * Read from ServiceTitan's API description; not yet run against a tenant (that needs partner
 * access). To confirm then: whether `Authorization` wants the bare token (as the docs show) and
 * the shape of the booking-provider-tags list.
 */

const HOSTS = {
  production: { auth: "https://auth.servicetitan.io", api: "https://api.servicetitan.io" },
  integration: {
    auth: "https://auth-integration.servicetitan.io",
    api: "https://api-integration.servicetitan.io",
  },
} as const;
const REFRESH_MARGIN_MS = 2 * 60_000;
const SOURCE = "Traiblazer assistant";

const keys = (platform: PlatformKeys) => {
  if (!platform.serviceTitan) {
    throw new ConnectorError("rejected", "ServiceTitan is not set up on this platform yet");
  }
  return platform.serviceTitan;
};

function call<T>(ctx: ConnectorContext, path: string, json?: unknown) {
  const { appKey, environment } = keys(ctx.platform);
  const tenant = encodeURIComponent(ctx.credentials.tenantId ?? "");
  return requestJson<T>(
    ctx.fetch,
    "ServiceTitan",
    `${HOSTS[environment].api}/crm/v2/tenant/${tenant}${path}`,
    {
      headers: { authorization: ctx.credentials.accessToken ?? "", "st-app-key": appKey },
      json,
    },
  );
}

const bookingsPath = (credentials: Credentials) =>
  `/booking-provider/${encodeURIComponent(credentials.bookingProviderId ?? "")}/bookings`;

export const serviceTitan: CrmConnector = {
  id: "servicetitan",
  name: "ServiceTitan",
  auth: "fields",
  fields: [
    {
      key: "tenantId",
      label: { en: "Tenant ID", fr: "ID du locataire (Tenant ID)" },
      hint: {
        en: "In ServiceTitan: Settings, Integrations, API Application Access.",
        fr: "Dans ServiceTitan : Settings, Integrations, API Application Access.",
      },
      secret: false,
      required: true,
      maxLength: 40,
    },
    {
      key: "clientId",
      label: { en: "Client ID", fr: "Client ID" },
      hint: {
        en: "Shown when your admin connects our app on the same screen.",
        fr: "Affiché quand votre administrateur connecte notre application au même écran.",
      },
      secret: false,
      required: true,
      maxLength: 200,
    },
    {
      key: "clientSecret",
      label: { en: "Client secret", fr: "Client secret" },
      secret: true,
      required: true,
      maxLength: 200,
    },
    {
      key: "bookingProviderId",
      label: { en: "Booking provider ID (optional)", fr: "ID du fournisseur de réservations (facultatif)" },
      hint: {
        en: "Create a tag under Settings, Integrations, Booking Provider Tags. Leave empty to use your first tag.",
        fr: "Créez une étiquette sous Settings, Integrations, Booking Provider Tags. Laissez vide pour utiliser votre première étiquette.",
      },
      secret: false,
      required: false,
      maxLength: 40,
    },
  ],
  ready: (platform) => !!platform.serviceTitan,

  async refresh(ctx) {
    const now = ctx.now?.() ?? new Date();
    const fresh = Number(ctx.credentials.expiresAt ?? 0) - now.getTime() > REFRESH_MARGIN_MS;
    if (fresh && ctx.credentials.accessToken && ctx.credentials.bookingProviderId) return null;

    let credentials = ctx.credentials;
    if (!fresh || !credentials.accessToken) {
      const token = await requestJson<{ access_token?: string; expires_in?: number }>(
        ctx.fetch,
        "ServiceTitan",
        `${HOSTS[keys(ctx.platform).environment].auth}/connect/token`,
        {
          form: {
            grant_type: "client_credentials",
            client_id: credentials.clientId ?? "",
            client_secret: credentials.clientSecret ?? "",
          },
        },
      ).catch((error: unknown) => {
        // ServiceTitan answers 400 invalid_client for a wrong ID or secret.
        if (error instanceof ConnectorError && error.failure === "rejected") {
          throw new ConnectorError("auth", "ServiceTitan refused the client ID or secret", error.status);
        }
        throw error;
      });
      if (!token?.access_token)
        throw new ConnectorError("auth", "ServiceTitan did not return an access token");
      credentials = {
        ...credentials,
        accessToken: token.access_token,
        expiresAt: String(now.getTime() + (token.expires_in ?? 900) * 1000),
      };
    }

    if (!credentials.bookingProviderId) {
      const tags = await call<{ data?: { id?: number | string }[] }>(
        { ...ctx, credentials },
        "/booking-provider-tags?pageSize=1",
      );
      const id = tags?.data?.[0]?.id;
      if (id === undefined) {
        throw new ConnectorError(
          "rejected",
          "No booking provider tag was found. Create one in ServiceTitan under Settings, Integrations, Booking Provider Tags.",
        );
      }
      credentials = { ...credentials, bookingProviderId: String(id) };
    }
    return credentials;
  },

  async verify(ctx) {
    // One call that checks the token, our app key, the tenant and the booking provider together.
    await call(ctx, `${bookingsPath(ctx.credentials)}?pageSize=1`);
    return { accountName: `Tenant ${ctx.credentials.tenantId}` };
  },

  async pushLead(ctx, lead) {
    const booking = await call<{ id?: number | string }>(ctx, bookingsPath(ctx.credentials), {
      source: SOURCE,
      name: lead.name,
      summary: leadNotes(lead),
      // We can't know; the CSR confirming the booking matches it to a customer.
      isFirstTimeClient: true,
      // Our id for the request, so ServiceTitan can tell a repeat from a new booking.
      externalId: lead.id,
      contacts: [
        ...(lead.phone ? [{ type: "Phone", value: phoneDigits(lead.phone) }] : []),
        ...(lead.email ? [{ type: "Email", value: lead.email }] : []),
      ],
      priority: lead.urgent ? "Urgent" : "Normal",
      isSendConfirmationEmail: false,
    });
    return { externalId: booking?.id === undefined ? null : String(booking.id), externalUrl: null };
  },
};
