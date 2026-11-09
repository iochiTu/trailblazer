import { assets, botKeys, bots, businessProfiles, tenants, withTenant } from "@traiblazer/db";
import { getPack, getTemplate, isSelectable, resolveBehavior } from "@traiblazer/industry-packs";
import {
  addAllowedOriginSchema,
  businessProfileSchema,
  createBotSchema,
  updateBotSchema,
} from "@traiblazer/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { isUuid, newPublicKey, toOrigin } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type TenantParams = { Params: { tenantId: string } };
type BotParams = { Params: { tenantId: string; botId: string } };

const DEFAULT_LANGUAGES = ["en", "fr"];

export async function botRoutes(app: FastifyInstance, { db, config, platform }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots";

  app.get<TenantParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const rows = await withTenant(db, request.tenant!.id, (tx) =>
      tx.select().from(bots).orderBy(desc(bots.createdAt)),
    );
    return { bots: rows };
  });

  app.post<TenantParams>(base, { preHandler: requireTenantRole(db, "editor") }, async (request, reply) => {
    const input = createBotSchema.parse(request.body);
    const { releasedPackPhase } = await platform!.policies();
    if (!isSelectable(input.pack, input.variant, releasedPackPhase)) {
      throw badRequest(
        `Industry "${input.pack}${input.variant ? `/${input.variant}` : ""}" is not available yet`,
      );
    }
    const languages = input.languages ?? DEFAULT_LANGUAGES;
    const defaultLanguage = input.defaultLanguage ?? languages[0]!;
    if (!languages.includes(defaultLanguage)) throw badRequest("defaultLanguage must be one of languages");

    const tenantId = request.tenant!.id;
    // The template is a starting point: its guidelines and workflows are copied into the
    // assistant, which the business then edits freely.
    const template = getTemplate(input.pack, input.variant);
    const result = await withTenant(db, tenantId, async (tx) => {
      const [bot] = await tx
        .insert(bots)
        .values({
          tenantId,
          name: input.name,
          pack: input.pack,
          variant: input.variant ?? null,
          guidelines: template.guidelines,
          workflows: template.workflows,
          languages,
          defaultLanguage,
          hostedPageEnabled: input.hostedPageEnabled ?? false,
        })
        .returning();
      // Start the profile with the business's name, so greetings and the web version show it.
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
      const [profile] = await tx
        .insert(businessProfiles)
        .values({ tenantId, botId: bot!.id, businessName: tenant?.name ?? null })
        .returning();
      const [key] = await tx
        .insert(botKeys)
        .values({
          tenantId,
          botId: bot!.id,
          publicKey: newPublicKey(config.NODE_ENV === "production"),
          allowedOrigins: [...new Set((input.allowedOrigins ?? []).map(toOrigin))],
        })
        .returning();
      await audit(tx, {
        tenantId,
        actorUserId: request.user!.id,
        action: "bot.created",
        targetType: "bot",
        targetId: bot!.id,
        metadata: { pack: input.pack, variant: input.variant ?? null },
      });
      return { bot: bot!, profile: profile!, keys: [key!] };
    });

    return reply.code(201).send({ ...result, pack: getPack(input.pack) });
  });

  app.get<BotParams>(`${base}/:botId`, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    return withTenant(db, request.tenant!.id, async (tx) => {
      const [bot] = await tx.select().from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      const [profile] = await tx
        .select()
        .from(businessProfiles)
        .where(eq(businessProfiles.botId, botId))
        .limit(1);
      const keys = await tx
        .select()
        .from(botKeys)
        .where(and(eq(botKeys.botId, botId), isNull(botKeys.revokedAt)));
      return {
        bot,
        profile: profile ?? null,
        keys,
        pack: getPack(bot.pack) ?? null,
        // What the assistant uses now (its own copy, or its template for older assistants).
        behavior: resolveBehavior(bot),
        // The industry template: suggested questions shown where the owner hasn't written their
        // own, plus guidelines and workflows to restore or add back.
        defaults: getTemplate(bot.pack, bot.variant),
        chatUrl: config.PUBLIC_URL,
      };
    });
  });

  app.patch<BotParams>(`${base}/:botId`, { preHandler: requireTenantRole(db, "editor") }, async (request) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    const input = updateBotSchema.parse(request.body);

    return withTenant(db, request.tenant!.id, async (tx) => {
      const [current] = await tx.select().from(bots).where(eq(bots.id, botId)).limit(1);
      if (!current) throw notFound("Assistant");
      if (input.variant !== undefined && !isSelectable(current.pack, input.variant, 4)) {
        throw badRequest(`Variant "${input.variant}" doesn't belong to ${current.pack}`);
      }
      const avatar = input.settings?.avatar;
      if (avatar?.kind === "image") {
        // RLS: only this business's own uploads are visible here.
        const [asset] = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.id, avatar.assetId), eq(assets.kind, "avatar")))
          .limit(1);
        if (!asset) throw badRequest("Unknown avatar image");
      }
      const languages = input.languages ?? current.languages;
      const defaultLanguage = input.defaultLanguage ?? current.defaultLanguage;
      if (!languages.includes(defaultLanguage)) throw badRequest("defaultLanguage must be one of languages");

      const [bot] = await tx
        .update(bots)
        .set({
          ...input,
          languages,
          defaultLanguage,
          // Settings are merged so one field can be changed without resending the others.
          ...(input.settings ? { settings: { ...current.settings, ...input.settings } } : {}),
        })
        .where(eq(bots.id, botId))
        .returning();
      await audit(tx, {
        tenantId: request.tenant!.id,
        actorUserId: request.user!.id,
        action: "bot.updated",
        targetType: "bot",
        targetId: botId,
        metadata: { fields: Object.keys(input) },
      });
      return { bot };
    });
  });

  app.delete<BotParams>(
    `${base}/:botId`,
    { preHandler: requireTenantRole(db, "admin") },
    async (request, reply) => {
      const { botId } = request.params;
      if (!isUuid(botId)) throw notFound("Assistant");
      await withTenant(db, request.tenant!.id, async (tx) => {
        const deleted = await tx
          .delete(bots)
          .where(eq(bots.id, botId))
          .returning({ id: bots.id, name: bots.name });
        if (!deleted.length) throw notFound("Assistant");
        await audit(tx, {
          tenantId: request.tenant!.id,
          actorUserId: request.user!.id,
          action: "bot.deleted",
          targetType: "bot",
          targetId: botId,
          metadata: { name: deleted[0]!.name },
        });
      });
      return reply.code(204).send();
    },
  );

  app.put<BotParams>(
    `${base}/:botId/profile`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { botId } = request.params;
      if (!isUuid(botId)) throw notFound("Assistant");
      const input = businessProfileSchema.parse(request.body);
      return withTenant(db, request.tenant!.id, async (tx) => {
        const [profile] = await tx
          .update(businessProfiles)
          .set(input)
          .where(eq(businessProfiles.botId, botId))
          .returning();
        if (!profile) throw notFound("Assistant");
        return { profile };
      });
    },
  );

  app.post<BotParams>(
    `${base}/:botId/allowed-origins`,
    { preHandler: requireTenantRole(db, "admin") },
    async (request) => {
      const { botId } = request.params;
      if (!isUuid(botId)) throw notFound("Assistant");
      const { origin } = addAllowedOriginSchema.parse(request.body);
      return withTenant(db, request.tenant!.id, async (tx) => {
        const [key] = await tx
          .select()
          .from(botKeys)
          .where(and(eq(botKeys.botId, botId), isNull(botKeys.revokedAt)))
          .limit(1);
        if (!key) throw notFound("Assistant");
        const allowedOrigins = [...new Set([...key.allowedOrigins, toOrigin(origin)])];
        const [updated] = await tx
          .update(botKeys)
          .set({ allowedOrigins })
          .where(eq(botKeys.id, key.id))
          .returning();
        return { key: updated };
      });
    },
  );
}
