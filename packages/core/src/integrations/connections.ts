import { type Db, integrationConnections, withTenant } from "@traiblazer/db";
import {
  type Connector,
  ConnectorError,
  type Credentials,
  type IntegrationsConfig,
  open,
  seal,
  sealContext,
} from "@traiblazer/integrations";
import { and, eq } from "drizzle-orm";
import { publicFetch } from "../knowledge/safe-fetch.js";

/**
 * A business's saved connections, whatever they are for (CRM or calendar): opening the sealed
 * credentials (refreshed first when they are about to expire) and noting how each call went.
 */

/** What a connection call needs; IntegrationDeps (crm.ts) has these and more. */
export interface ConnectionDeps {
  db: Db;
  integrations: IntegrationsConfig;
  /** Outbound HTTP; defaults to one that refuses private addresses. Tests pass a fake. */
  fetch?: typeof fetch;
}

type IntegrationDeps = ConnectionDeps;

export interface ConnectionRef {
  tenantId: string;
  botId: string;
  provider: string;
}

const clip = (text: string, max = 500) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type Opened =
  | { state: "ready"; credentials: Credentials }
  | { state: "missing" }
  | { state: "failed"; error: ConnectorError };

/**
 * Opens a connection's credentials, refreshing them first when they are about to expire. The row
 * is locked while that happens: services that rotate refresh tokens (Jobber) cancel the old token on
 * use, so two jobs refreshing at once would lock the business out.
 */
export async function openCredentials(
  deps: IntegrationDeps,
  connector: Connector,
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
export async function recordOutcome(deps: IntegrationDeps, ref: ConnectionRef, error: ConnectorError | null) {
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
