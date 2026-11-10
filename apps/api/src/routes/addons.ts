import { addonCatalog, getAddon, parseAddonConfig } from "@traiblazer/addons";
import { botAddons, bots, withTenant } from "@traiblazer/db";
import { updateAddonSchema } from "@traiblazer/shared";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string } };
type AddonParams = { Params: { tenantId: string; botId: string; addonId: string } };

/**
 * Add-on market:
 *   GET    /v1/catalog/addons                                   every add-on (market listing)
 *   GET    /v1/tenants/:t/bots/:b/addons                        market + this assistant's add-ons
 *   PUT    /v1/tenants/:t/bots/:b/addons/:addonId               install, change settings, turn on/off
 *   DELETE /v1/tenants/:t/bots/:b/addons/:addonId               remove
 *
 * Installing and configuring needs the admin role: add-ons can send conversation content outside
 * the platform (e.g. notification emails), like the allowed-websites setting.
 */
export async function addonRoutes(app: FastifyInstance, { db }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots/:botId/addons";

  app.get("/v1/catalog/addons", async () => ({ addons: addonCatalog() }));

  app.get<BotParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    const installed = await withTenant(db, request.tenant!.id, async (tx) => {
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      return tx.select().from(botAddons).where(eq(botAddons.botId, botId)).orderBy(asc(botAddons.createdAt));
    });
    return {
      catalog: addonCatalog(),
      installed: installed.map((row) => {
        const addon = getAddon(row.addonId);
        // Settings saved by an add-on that changed or left the market are flagged, not hidden.
        const parsed = addon ? parseAddonConfig(addon, row.config, row.configVersion) : null;
        return {
          addonId: row.addonId,
          enabled: row.enabled,
          config: parsed?.ok ? parsed.config : row.config,
          status: !addon ? "unknown" : parsed?.ok ? "ok" : "invalid",
          updatedAt: row.updatedAt,
        };
      }),
    };
  });

  app.put<AddonParams>(
    `${base}/:addonId`,
    { preHandler: requireTenantRole(db, "admin") },
    async (request) => {
      const { botId, addonId } = request.params;
      if (!isUuid(botId)) throw notFound("Assistant");
      const addon = getAddon(addonId);
      if (!addon) throw notFound("Add-on");
      if (addon.status !== "available") throw badRequest(`"${addon.name.en}" is not available yet`);
      const input = updateAddonSchema.parse(request.body ?? {});
      const tenantId = request.tenant!.id;

      return withTenant(db, tenantId, async (tx) => {
        const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
        if (!bot) throw notFound("Assistant");
        const [current] = await tx
          .select()
          .from(botAddons)
          .where(and(eq(botAddons.botId, botId), eq(botAddons.addonId, addonId)))
          .limit(1);

        // New settings are merged over the saved ones (upgraded first if an older version saved
        // them), so a toggle can be sent on its own.
        const saved =
          current && current.configVersion < addon.version && addon.migrate
            ? addon.migrate(current.config, current.configVersion)
            : (current?.config ?? {});
        const parsed = parseAddonConfig(addon, { ...(saved as object), ...(input.config ?? {}) });
        if (!parsed.ok) {
          throw new HttpError(400, "invalid_addon_config", "Please check the add-on settings", parsed.issues);
        }
        const values = {
          enabled: input.enabled ?? current?.enabled ?? true,
          config: parsed.config as Record<string, unknown>,
          configVersion: addon.version,
        };
        const [row] = current
          ? await tx.update(botAddons).set(values).where(eq(botAddons.id, current.id)).returning()
          : await tx
              .insert(botAddons)
              .values({ tenantId, botId, addonId, ...values })
              .returning();
        await audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: current ? "addon.updated" : "addon.installed",
          targetType: "bot",
          targetId: botId,
          metadata: { addonId, enabled: values.enabled, fields: Object.keys(input.config ?? {}) },
        });
        return {
          addon: {
            addonId,
            enabled: row!.enabled,
            config: row!.config,
            status: "ok",
            updatedAt: row!.updatedAt,
          },
        };
      });
    },
  );

  app.delete<AddonParams>(
    `${base}/:addonId`,
    { preHandler: requireTenantRole(db, "admin") },
    async (request, reply) => {
      const { botId, addonId } = request.params;
      if (!isUuid(botId)) throw notFound("Assistant");
      const tenantId = request.tenant!.id;
      await withTenant(db, tenantId, async (tx) => {
        const deleted = await tx
          .delete(botAddons)
          .where(and(eq(botAddons.botId, botId), eq(botAddons.addonId, addonId)))
          .returning({ id: botAddons.id });
        if (!deleted.length) throw notFound("Add-on");
        await audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: "addon.removed",
          targetType: "bot",
          targetId: botId,
          metadata: { addonId },
        });
      });
      return reply.code(204).send();
    },
  );
}
