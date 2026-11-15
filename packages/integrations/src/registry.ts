import { googleCalendar } from "./connectors/google-calendar.js";
import { housecallPro } from "./connectors/housecall-pro.js";
import { jobber } from "./connectors/jobber.js";
import { serviceTitan } from "./connectors/servicetitan.js";
import { webhook } from "./connectors/webhook.js";
import { parseSecretKey } from "./crypto.js";
import type {
  AnyConnector,
  CalendarConnector,
  CredentialField,
  CrmConnector,
  PlatformKeys,
} from "./types.js";

/**
 * Every outside service the platform can connect to. To add one: write a connector in connectors/,
 * add it here, add tests, and add its add-on in @traiblazer/addons (same id): builtin/crm.ts for a
 * CRM, builtin/calendar.ts for a calendar.
 */
export const connectors: readonly AnyConnector[] = [
  jobber,
  housecallPro,
  serviceTitan,
  webhook,
  googleCalendar,
];

const byId = new Map(connectors.map((c) => [c.id, c]));
if (byId.size !== connectors.length) throw new Error("Duplicate connector id");

export const getConnector = (id: string): AnyConnector | undefined => byId.get(id);

/** The CRM with this id (undefined for an unknown id or another kind of connector). */
export const getCrmConnector = (id: string): CrmConnector | undefined => {
  const connector = byId.get(id);
  return connector?.kind === "crm" ? connector : undefined;
};

/** The calendar with this id (undefined for an unknown id or another kind of connector). */
export const getCalendarConnector = (id: string): CalendarConnector | undefined => {
  const connector = byId.get(id);
  return connector?.kind === "calendar" ? connector : undefined;
};

/** What the platform needs to run integrations, read once from the environment. */
export interface IntegrationsConfig {
  /** Seals credentials and signs OAuth state. Null = integrations are off on this server. */
  secretKey: Buffer | null;
  platform: PlatformKeys;
}

/** Reads INTEGRATIONS_SECRET_KEY and each service's platform keys (our developer apps). Throws on a malformed secret key. */
export function loadIntegrationsConfig(env: Record<string, string | undefined>): IntegrationsConfig {
  const platform: PlatformKeys = {};
  if (env.JOBBER_CLIENT_ID && env.JOBBER_CLIENT_SECRET) {
    platform.jobber = { clientId: env.JOBBER_CLIENT_ID, clientSecret: env.JOBBER_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    platform.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  if (env.SERVICETITAN_APP_KEY) {
    platform.serviceTitan = {
      appKey: env.SERVICETITAN_APP_KEY,
      environment: env.SERVICETITAN_ENVIRONMENT === "integration" ? "integration" : "production",
    };
  }
  return { secretKey: parseSecretKey(env.INTEGRATIONS_SECRET_KEY), platform };
}

/** What the portal needs to show a connector's "Connect" step (serializable, no secrets). */
export interface ConnectorInfo {
  id: string;
  name: string;
  kind: "crm" | "calendar";
  auth: "fields" | "oauth2";
  fields: CredentialField[];
  /**
   * False when this server can't connect it yet: no INTEGRATIONS_SECRET_KEY, or the platform's
   * own keys for this CRM (developer app, partner app key) aren't set.
   */
  available: boolean;
}

export const connectorInfo = (connector: AnyConnector, config: IntegrationsConfig): ConnectorInfo => ({
  id: connector.id,
  name: connector.name,
  kind: connector.kind,
  auth: connector.auth,
  fields: connector.fields,
  available: !!config.secretKey && connector.ready(config.platform),
});

/** The text a connection's credentials are sealed against (see `seal`). */
export const sealContext = (tenantId: string, botId: string, provider: string) =>
  `integration:${tenantId}:${botId}:${provider}`;
