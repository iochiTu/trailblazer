import {
  bots,
  businessProfiles,
  type Db,
  integrationConnections,
  leadSyncs,
  leads,
  tenants,
  withTenant,
} from "@traiblazer/db";
import { getTemplate } from "@traiblazer/industry-packs";
import {
  ConnectorError,
  type Credentials,
  type CrmConnector,
  type CrmLead,
  getConnector,
  type IntegrationsConfig,
  open,
  seal,
  sealContext,
} from "@traiblazer/integrations";
import { and, eq, sql } from "drizzle-orm";
import { publicFetch } from "../knowledge/safe-fetch.js";

export interface IntegrationDeps {
  db: Db;
  integrations: IntegrationsConfig;
  /** Outbound HTTP; defaults to one that refuses private addresses. Tests pass a fake. */
  fetch?: typeof fetch;
  /** Admin portal origin, for the link back to the request. */
  adminUrl?: string;
}

export interface ConnectionRef {
  tenantId: string;
  botId: string;
  provider: string;
}

const clip = (text: string, max = 500) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Checks credentials with the CRM (refreshing or completing them first when the connector needs
 * to, e.g. fetching an access token), then saves them sealed. Throws ConnectorError when the CRM
 * refuses them: nothing is stored.
 */
export async function connectIntegration(
  deps: IntegrationDeps,
  ref: ConnectionRef & { credentials: Credentials; userId: string | null },
): Promise<{ accountName: string | null }> {
  const connector = getConnector(ref.provider);
  const key = deps.integrations.secretKey;
  if (!connector || !key) throw new ConnectorError("rejected", "This integration is not available");
  const base = { platform: deps.integrations.platform, fetch: deps.fetch ?? publicFetch };
  const credentials =
    (await connector.refresh?.({ ...base, credentials: ref.credentials })) ?? ref.credentials;
  const { accountName } = await connector.verify({ ...base, credentials });

  const values = {
    status: "connected" as const,
    accountName,
    credentials: seal(key, credentials, sealContext(ref.tenantId, ref.botId, ref.provider)),
    lastError: null,
    lastErrorAt: null,
    connectedBy: ref.userId,
  };
  await withTenant(deps.db, ref.tenantId, (tx) =>
    tx
      .insert(integrationConnections)
      .values({ tenantId: ref.tenantId, botId: ref.botId, provider: ref.provider, ...values })
      .onConflictDoUpdate({
        target: [integrationConnections.botId, integrationConnections.provider],
        set: values,
      }),
  );
  return { accountName };
}

type Opened =
  | { state: "ready"; credentials: Credentials }
  | { state: "missing" }
  | { state: "failed"; error: ConnectorError };

/**
 * Opens a connection's credentials, refreshing them first when they are about to expire. The row
 * is locked while that happens: CRMs that rotate refresh tokens (Jobber) cancel the old token on
 * use, so two jobs refreshing at once would lock the business out.
 */
async function openCredentials(
  deps: IntegrationDeps,
  connector: CrmConnector,
  ref: ConnectionRef,
): Promise<Opened> {
  const key = deps.integrations.secretKey!;
  const context = sealContext(ref.tenantId, ref.botId, ref.provider);
  return withTenant(deps.db, ref.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(eq(integrationConnections.botId, ref.botId), eq(integrationConnections.provider, ref.provider)),
      )
      .limit(1)
      .for("update");
    if (!row) return { state: "missing" };
    let credentials: Credentials;
    try {
      credentials = open<Credentials>(key, row.credentials, context);
    } catch {
      // Sealed with another key (it was changed) or damaged: only connecting again fixes it.
      return {
        state: "failed",
        error: new ConnectorError("auth", "The saved connection can't be read. Please connect again."),
      };
    }
    if (!connector.refresh) return { state: "ready", credentials };
    try {
      const refreshed = await connector.refresh({
        credentials,
        platform: deps.integrations.platform,
        fetch: deps.fetch ?? publicFetch,
      });
      if (!refreshed) return { state: "ready", credentials };
      await tx
        .update(integrationConnections)
        .set({ credentials: seal(key, refreshed, context) })
        .where(eq(integrationConnections.id, row.id));
      return { state: "ready", credentials: refreshed };
    } catch (error) {
      if (error instanceof ConnectorError) return { state: "failed", error };
      throw error;
    }
  });
}

/** Notes on the connection how the last call went, so the portal can show it. */
async function recordOutcome(deps: IntegrationDeps, ref: ConnectionRef, error: ConnectorError | null) {
  await withTenant(deps.db, ref.tenantId, (tx) =>
    tx
      .update(integrationConnections)
      .set(
        error
          ? {
              lastError: clip(error.message),
              lastErrorAt: new Date(),
              // Only refused credentials change the status: an outage or one bad request doesn't.
              ...(error.failure === "auth" ? { status: "error" as const } : {}),
            }
          : { status: "connected" as const, lastSuccessAt: new Date(), lastError: null, lastErrorAt: null },
      )
      .where(
        and(eq(integrationConnections.botId, ref.botId), eq(integrationConnections.provider, ref.provider)),
      ),
  );
}

export interface CrmLeadPayload {
  botId: string;
  provider: string;
  leadId: string;
}

/**
 * Hands one request to a connected CRM (queued by a CRM add-on, or by staff pressing "Send
 * again"). Safe to run twice: a request already sent to this CRM is skipped. A CRM outage throws,
 * so the job is retried with backoff; refused credentials or a refused request are recorded on
 * the request for staff and not retried.
 */
export async function pushLeadToCrm(
  deps: IntegrationDeps,
  tenantId: string,
  payload: CrmLeadPayload,
): Promise<"done" | "skipped" | "failed"> {
  const connector = getConnector(payload.provider);
  if (!connector || !deps.integrations.secretKey) return "skipped";
  const ref = { tenantId, botId: payload.botId, provider: payload.provider };

  const found = await withTenant(deps.db, tenantId, async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, payload.leadId), eq(leads.botId, payload.botId)))
      .limit(1);
    // Removed since it was queued, or left in the owner's own test chat: nothing to send.
    if (!lead || lead.channel === "playground") return null;
    const [sync] = await tx
      .select({ status: leadSyncs.status })
      .from(leadSyncs)
      .where(and(eq(leadSyncs.leadId, lead.id), eq(leadSyncs.provider, payload.provider)))
      .limit(1);
    if (sync?.status === "sent") return null;
    const [bot] = await tx
      .select({ name: bots.name, pack: bots.pack, variant: bots.variant })
      .from(bots)
      .where(eq(bots.id, payload.botId))
      .limit(1);
    const [profile] = await tx
      .select({ businessName: businessProfiles.businessName })
      .from(businessProfiles)
      .where(eq(businessProfiles.botId, payload.botId))
      .limit(1);
    const [tenant] = await tx
      .select({ ownerLanguage: tenants.ownerLanguage })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return bot ? { lead, bot, profile, tenant } : null;
  });
  if (!found) return "skipped";
  const { lead, bot, profile, tenant } = found;

  const record = (values: {
    status: "sent" | "failed";
    externalId?: string | null;
    externalUrl?: string | null;
    error?: string | null;
  }) => {
    const row = {
      status: values.status,
      externalId: values.externalId ?? null,
      externalUrl: values.externalUrl ?? null,
      error: values.error ?? null,
    };
    return withTenant(deps.db, tenantId, (tx) =>
      tx
        .insert(leadSyncs)
        .values({ tenantId, botId: payload.botId, leadId: lead.id, provider: payload.provider, ...row })
        .onConflictDoUpdate({
          target: [leadSyncs.leadId, leadSyncs.provider],
          set: row,
          // A late duplicate job never turns a sent request back into a failed one.
          setWhere: sql`${leadSyncs.status} <> 'sent'`,
        }),
    );
  };

  const fail = async (error: ConnectorError) => {
    await record({ status: "failed", error: clip(error.message) });
    await recordOutcome(deps, ref, error);
    if (error.failure === "temporary") throw error;
    return "failed" as const;
  };

  const opened = await openCredentials(deps, connector, ref);
  if (opened.state === "missing") return "skipped";
  if (opened.state === "failed") return fail(opened.error);

  const ownerLanguage = tenant?.ownerLanguage === "fr" ? "fr" : "en";
  const crmLead: CrmLead = {
    id: lead.id,
    kind: lead.kind,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    bestTime: lead.bestTime,
    message: lead.message,
    language: lead.language,
    urgent: lead.urgent,
    details: getTemplate(bot.pack, bot.variant)
      .leadFields.filter((f) => lead.details[f.key])
      .map((f) => ({ key: f.key, label: f.label[ownerLanguage], value: lead.details[f.key]! })),
    photoCount: lead.attachmentIds.length,
    createdAt: lead.createdAt,
    businessName: profile?.businessName ?? bot.name,
    ownerLanguage,
    requestUrl: deps.adminUrl ? `${deps.adminUrl}/t/${tenantId}/bots/${payload.botId}?tab=requests` : null,
  };

  try {
    const result = await connector.pushLead(
      {
        credentials: opened.credentials,
        platform: deps.integrations.platform,
        fetch: deps.fetch ?? publicFetch,
      },
      crmLead,
    );
    await record({ status: "sent", externalId: result.externalId, externalUrl: result.externalUrl });
    await recordOutcome(deps, ref, null);
    return "done";
  } catch (error) {
    if (error instanceof ConnectorError) return fail(error);
    throw error;
  }
}
