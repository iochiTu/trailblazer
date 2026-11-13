import { getAddon } from "@traiblazer/addons";
import { connectIntegration, JOB_TYPES, publicFetch } from "@traiblazer/core";
import { botAddons, bots, integrationConnections, jobs, leadSyncs, leads, withTenant } from "@traiblazer/db";
import {
  ConnectorError,
  type Credentials,
  connectorInfo,
  connectors,
  getConnector,
  readToken,
  signToken,
} from "@traiblazer/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string } };
type ProviderParams = { Params: { tenantId: string; botId: string; provider: string } };
type SyncParams = { Params: { tenantId: string; botId: string; leadId: string; provider: string } };

const credentialsSchema = z.object({ credentials: z.record(z.string(), z.string().max(4096)) });

/** How long the owner has to finish signing in at the CRM. */
const OAUTH_STATE_TTL_MS = 10 * 60_000;
interface OAuthState extends Record<string, unknown> {
  t: string;
  b: string;
  p: string;
  u: string;
}

/**
 * CRM connections (connectors live in @traiblazer/integrations; the add-ons that use them in
 * @traiblazer/addons):
 *   GET    /v1/tenants/:t/bots/:b/integrations                       connectors + this assistant's connections
 *   PUT    /v1/tenants/:t/bots/:b/integrations/:provider             connect with pasted keys (checked with the CRM first)
 *   POST   /v1/tenants/:t/bots/:b/integrations/:provider/oauth       start signing in at the CRM → { url }
 *   GET    /v1/integrations/oauth/callback                           where the CRM sends the owner back
 *   DELETE /v1/tenants/:t/bots/:b/integrations/:provider             disconnect (credentials are erased)
 *   POST   /v1/tenants/:t/bots/:b/leads/:leadId/sync/:provider       send a request to the CRM again
 *
 * Connecting needs the admin role, like add-ons: it sends visitors' details outside the platform.
 * Credentials go in and never come out: no route returns them, sealed or not.
 */
export async function integrationRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const integrations = ctx.integrations ?? { secretKey: null, platform: {} };
  const deps = {
    db,
    integrations,
    fetch: ctx.integrationsFetch,
    adminUrl: new URL(config.ADMIN_ORIGIN).origin,
  };
  const base = "/v1/tenants/:tenantId/bots/:botId/integrations";
  // The CRM sends the owner's browser back through the admin portal's /api proxy, so the session
  // cookie comes along.
  const redirectUri = `${new URL(config.ADMIN_ORIGIN).origin}/api/v1/integrations/oauth/callback`;

  /** The connector, when this server can use it; otherwise the matching HTTP error. */
  const usable = (provider: string) => {
    const connector = getConnector(provider);
    if (!connector) throw notFound("Integration");
    if (!connectorInfo(connector, integrations).available) {
      throw new HttpError(
        409,
        "integration_unavailable",
        `${connector.name} can't be connected on this platform yet`,
      );
    }
    return connector;
  };

  const assertBot = (tenantId: string, botId: string) =>
    withTenant(db, tenantId, async (tx) => {
      if (!isUuid(botId)) throw notFound("Assistant");
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
    });

  app.get<BotParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { botId } = request.params;
    await assertBot(request.tenant!.id, botId);
    const rows = await withTenant(db, request.tenant!.id, (tx) =>
      tx.select().from(integrationConnections).where(eq(integrationConnections.botId, botId)),
    );
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return {
      integrations: connectors.map((connector) => {
        const row = byProvider.get(connector.id);
        return {
          ...connectorInfo(connector, integrations),
          connection: row
            ? {
                status: row.status,
                accountName: row.accountName,
                lastError: row.lastError,
                lastErrorAt: row.lastErrorAt,
                lastSuccessAt: row.lastSuccessAt,
                connectedAt: row.updatedAt,
              }
            : null,
        };
      }),
    };
  });

  app.put<ProviderParams>(
    `${base}/:provider`,
    { preHandler: requireTenantRole(db, "admin") },
    async (request) => {
      const { botId, provider } = request.params;
      const connector = usable(provider);
      if (connector.auth !== "fields") throw badRequest(`${connector.name} is connected by signing in`);
      const tenantId = request.tenant!.id;
      await assertBot(tenantId, botId);

      // Only the connector's own fields are kept; anything else in the body is dropped.
      const input = credentialsSchema.parse(request.body ?? {}).credentials;
      const credentials: Credentials = {};
      const issues: { path: string; message: string }[] = [];
      for (const field of connector.fields) {
        const value = (input[field.key] ?? "").trim();
        if (!value) {
          if (field.required) issues.push({ path: field.key, message: "Required" });
          continue;
        }
        if (field.maxLength && value.length > field.maxLength) {
          issues.push({ path: field.key, message: "Too long" });
        }
        credentials[field.key] = value;
      }
      if (issues.length) {
        throw new HttpError(400, "invalid_credentials", "Please check what you entered", issues);
      }

      const { accountName } = await connect({
        tenantId,
        botId,
        provider,
        credentials,
        userId: request.user!.id,
      });
      return { connection: { status: "connected", accountName } };
    },
  );

  app.post<ProviderParams>(
    `${base}/:provider/oauth`,
    { preHandler: requireTenantRole(db, "admin") },
    async (request) => {
      const { botId, provider } = request.params;
      const connector = usable(provider);
      if (!connector.oauth) throw badRequest(`${connector.name} is connected with keys`);
      await assertBot(request.tenant!.id, botId);
      const state = signToken(
        integrations.secretKey!,
        { t: request.tenant!.id, b: botId, p: provider, u: request.user!.id },
        OAUTH_STATE_TTL_MS,
      );
      return { url: connector.oauth.authorizeUrl({ platform: integrations.platform, redirectUri, state }) };
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/v1/integrations/oauth/callback",
    async (request, reply) => {
      const { code, state } = request.query;
      const admin = new URL(config.ADMIN_ORIGIN).origin;
      // A forged, damaged or expired state names no assistant we can trust: back to the portal's home.
      const claims =
        integrations.secretKey && state ? readToken<OAuthState>(integrations.secretKey, state) : null;
      if (!claims || !isUuid(claims.t) || !isUuid(claims.b)) return reply.redirect(admin);
      const back = (result: "connected" | "error") =>
        reply.redirect(
          `${admin}/t/${claims.t}/bots/${claims.b}?${new URLSearchParams({ tab: "addons", integration: claims.p, result })}`,
        );
      // The person coming back must be the one who started, still signed in and still an admin.
      if (!request.user || request.user.id !== claims.u || !code) return back("error");
      try {
        await requireTenantRole(db, "admin")({ user: request.user, params: { tenantId: claims.t } } as never);
        const connector = usable(claims.p);
        if (!connector.oauth) return back("error");
        await assertBot(claims.t, claims.b);
        const credentials = await connector.oauth.exchangeCode({
          platform: integrations.platform,
          fetch: deps.fetch ?? publicFetch,
          code,
          redirectUri,
        });
        await connect({
          tenantId: claims.t,
          botId: claims.b,
          provider: claims.p,
          credentials,
          userId: claims.u,
        });
        return back("connected");
      } catch (error) {
        request.log.warn({ err: error, provider: claims.p }, "integration sign-in failed");
        return back("error");
      }
    },
  );

  app.delete<ProviderParams>(
    `${base}/:provider`,
    { preHandler: requireTenantRole(db, "admin") },
    async (request, reply) => {
      const { botId, provider } = request.params;
      if (!isUuid(botId)) throw notFound("Assistant");
      const tenantId = request.tenant!.id;
      await withTenant(db, tenantId, async (tx) => {
        const deleted = await tx
          .delete(integrationConnections)
          .where(and(eq(integrationConnections.botId, botId), eq(integrationConnections.provider, provider)))
          .returning({ id: integrationConnections.id });
        if (!deleted.length) throw notFound("Connection");
        await audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: "integration.disconnected",
          targetType: "bot",
          targetId: botId,
          metadata: { provider },
        });
      });
      return reply.code(204).send();
    },
  );

  app.post<SyncParams>(
    "/v1/tenants/:tenantId/bots/:botId/leads/:leadId/sync/:provider",
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { botId, leadId, provider } = request.params;
      if (!isUuid(botId) || !isUuid(leadId)) throw notFound("Request");
      const connector = usable(provider);
      const tenantId = request.tenant!.id;
      await withTenant(db, tenantId, async (tx) => {
        const [lead] = await tx
          .select({ id: leads.id, channel: leads.channel })
          .from(leads)
          .where(and(eq(leads.id, leadId), eq(leads.botId, botId)))
          .limit(1);
        if (!lead) throw notFound("Request");
        if (lead.channel === "playground") throw badRequest("Test requests are never sent");
        // The add-on must be on and connected, as when the request first came in.
        const addonId = getAddon(provider)?.integration === provider ? provider : undefined;
        const [addon] = addonId
          ? await tx
              .select({ enabled: botAddons.enabled })
              .from(botAddons)
              .where(and(eq(botAddons.botId, botId), eq(botAddons.addonId, addonId)))
              .limit(1)
          : [];
        const [connection] = await tx
          .select({ id: integrationConnections.id })
          .from(integrationConnections)
          .where(and(eq(integrationConnections.botId, botId), eq(integrationConnections.provider, provider)))
          .limit(1);
        if (!addonId || !addon?.enabled || !connection) {
          throw new HttpError(409, "integration_off", `${connector.name} is not connected and turned on`);
        }
        const [sync] = await tx
          .select({ status: leadSyncs.status })
          .from(leadSyncs)
          .where(and(eq(leadSyncs.leadId, leadId), eq(leadSyncs.provider, provider)))
          .limit(1);
        if (sync?.status === "sent") throw new HttpError(409, "already_sent", "Already sent");
        await tx.insert(jobs).values({
          tenantId,
          type: JOB_TYPES.addonEffect,
          payload: { botId, addonId, effect: { kind: "crm.lead", provider, leadId } },
        });
        await audit(tx, {
          tenantId,
          actorUserId: request.user?.id ?? null,
          action: "lead.sync_requested",
          targetType: "lead",
          targetId: leadId,
          metadata: { provider },
        });
      });
      return reply.code(202).send({ queued: true });
    },
  );

  /** Checks with the CRM, saves, and audits. A CRM refusal becomes a 400 the portal can show. */
  async function connect(input: {
    tenantId: string;
    botId: string;
    provider: string;
    credentials: Credentials;
    userId: string;
  }) {
    let result: { accountName: string | null };
    try {
      result = await connectIntegration(deps, input);
    } catch (error) {
      if (error instanceof ConnectorError) {
        throw new HttpError(error.failure === "temporary" ? 502 : 400, "connection_failed", error.message);
      }
      throw error;
    }
    await withTenant(db, input.tenantId, (tx) =>
      audit(tx, {
        tenantId: input.tenantId,
        actorUserId: input.userId,
        action: "integration.connected",
        targetType: "bot",
        targetId: input.botId,
        metadata: { provider: input.provider },
      }),
    );
    return result;
  }
}
