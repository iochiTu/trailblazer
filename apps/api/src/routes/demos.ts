import { DEMO_RETRY_MS, JOB_TYPES } from "@traiblazer/core";
import {
  botKeys,
  bots,
  catalogItems,
  conversations,
  demos,
  jobs,
  knowledgeSources,
  leads,
  memberships,
  operatorAuditLogs,
  pageStats,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import { getPack, isSelectable } from "@traiblazer/industry-packs";
import { createDemoSchema, handOverDemoSchema } from "@traiblazer/shared";
import { and, count, desc, eq, isNull, ne, sql, sum } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { createAssistant } from "../lib/assistants.js";
import { audit } from "../lib/audit.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { isUuid, slugify } from "../lib/ids.js";
import { requireSuperAdmin } from "../plugins/auth.js";
import { assertLooksPublic } from "./knowledge.js";

type IdParams = { Params: { id: string } };

/** Demos shown in the console (newest first). */
const LIST_LIMIT = 50;

/**
 * Prospect demos (operator console, super admins only; PLAN §2.2 and §7.5):
 *   GET    /v1/operator/demos                 the demos, with their page link and how they were used
 *   POST   /v1/operator/demos                 build a demo page from a prospect's public information
 *   POST   /v1/operator/demos/:id/build       read the sources again and fill the page in again
 *   POST   /v1/operator/demos/:id/hand-over   give the business to its owner's account
 *   DELETE /v1/operator/demos/:id             remove a demo and everything in it
 *
 * A demo is a business of kind "demo" with no members: its page carries a demo notice and is never
 * listed by search engines. Operators edit it like any business, through support access.
 */
export async function demoRoutes(app: FastifyInstance, { db, config, platform }: AppContext) {
  const guard = { preHandler: requireSuperAdmin };

  const log = (request: FastifyRequest, action: string, targetId: string, metadata: object = {}) =>
    db.insert(operatorAuditLogs).values({
      actorUserId: request.user!.id,
      action,
      targetType: "demo",
      targetId,
      metadata: metadata as Record<string, unknown>,
    });

  /** The demo with its business, or 404. */
  const find = async (id: string) => {
    if (!isUuid(id)) throw notFound("Demo");
    const [row] = await db
      .select({ demo: demos, tenant: tenants })
      .from(demos)
      .innerJoin(tenants, eq(tenants.id, demos.tenantId))
      .where(eq(demos.id, id))
      .limit(1);
    if (!row) throw notFound("Demo");
    return row;
  };

  app.get("/v1/operator/demos", guard, async () => {
    const rows = await db
      .select({ demo: demos, tenantName: tenants.name, createdBy: users.email })
      .from(demos)
      .innerJoin(tenants, eq(tenants.id, demos.tenantId))
      .leftJoin(users, eq(users.id, demos.createdBy))
      .orderBy(desc(demos.createdAt))
      .limit(LIST_LIMIT);

    const list = [];
    for (const { demo, tenantName, createdBy } of rows) {
      // What is on the page and how it was used, read inside the demo's own business (RLS).
      const inside = await withTenant(db, demo.tenantId, async (tx) => {
        const [bot] = await tx
          .select({ pack: bots.pack, variant: bots.variant })
          .from(bots)
          .where(eq(bots.id, demo.botId))
          .limit(1);
        const [key] = await tx
          .select({ publicKey: botKeys.publicKey })
          .from(botKeys)
          .where(and(eq(botKeys.botId, demo.botId), isNull(botKeys.revokedAt)))
          .limit(1);
        const sources = await tx
          .select({ type: knowledgeSources.type, status: knowledgeSources.status, url: knowledgeSources.url })
          .from(knowledgeSources)
          .where(eq(knowledgeSources.botId, demo.botId));
        const [services] = await tx
          .select({ n: count() })
          .from(catalogItems)
          .where(eq(catalogItems.botId, demo.botId));
        const [views] = await tx
          .select({ n: sum(pageStats.views) })
          .from(pageStats)
          .where(eq(pageStats.botId, demo.botId));
        // Chats on the page itself; the operator's own test chats (playground) don't count.
        const [chats] = await tx
          .select({ n: count() })
          .from(conversations)
          .where(and(eq(conversations.botId, demo.botId), ne(conversations.channel, "playground")));
        const [requests] = await tx
          .select({ n: count() })
          .from(leads)
          .where(and(eq(leads.botId, demo.botId), ne(leads.channel, "playground")));
        return {
          bot,
          publicKey: key?.publicKey ?? null,
          sources,
          services: services?.n ?? 0,
          views: Number(views?.n ?? 0),
          conversations: chats?.n ?? 0,
          requests: requests?.n ?? 0,
        };
      });
      list.push({
        id: demo.id,
        tenantId: demo.tenantId,
        botId: demo.botId,
        name: tenantName,
        industry: getPack(inside.bot?.pack ?? "")?.name ?? inside.bot?.pack ?? null,
        status: demo.status,
        error: demo.error,
        note: demo.note,
        createdBy,
        createdAt: demo.createdAt,
        handedOverTo: demo.handedOverTo,
        handedOverAt: demo.handedOverAt,
        pageUrl: inside.publicKey ? `${config.PUBLIC_URL}/c/${inside.publicKey}` : null,
        sources: inside.sources,
        services: inside.services,
        views: inside.views,
        conversations: inside.conversations,
        requests: inside.requests,
      });
    }
    return { demos: list };
  });

  app.post("/v1/operator/demos", guard, async (request, reply) => {
    const input = createDemoSchema.parse(request.body);
    const [policies, allPlans] = await Promise.all([platform!.policies(), platform!.plans()]);
    if (!isSelectable(input.pack, input.variant, policies.releasedPackPhase)) {
      throw badRequest(
        `Industry "${input.pack}${input.variant ? `/${input.variant}` : ""}" is not available yet`,
      );
    }
    if (input.websiteUrl) assertLooksPublic(input.websiteUrl);
    const plan = allPlans.find((p) => p.id === policies.defaultPlan && p.active)?.id ?? "trial";
    const userId = request.user!.id;

    const created = await db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: input.businessName,
          slug: slugify(input.businessName),
          kind: "demo",
          plan,
          ownerLanguage: input.language,
        })
        .returning();
      const tenantId = tenant!.id;
      // The rest is the demo's own data (RLS): set the tenant for this transaction.
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

      const { bot, key } = await createAssistant(tx, {
        tenantId,
        name: input.businessName,
        pack: input.pack,
        variant: input.variant,
        // The page is in the prospect's language; the chat answers in English and French.
        languages: input.language === "fr" ? ["fr", "en"] : ["en", "fr"],
        defaultLanguage: input.language,
        // The demo link opens the business page.
        hostedPageEnabled: true,
        businessName: input.businessName,
        websiteUrl: input.websiteUrl ? new URL(input.websiteUrl).origin : null,
        live: config.NODE_ENV === "production",
      });

      const sources = await tx
        .insert(knowledgeSources)
        .values([
          ...(input.websiteUrl
            ? [
                {
                  tenantId,
                  botId: bot.id,
                  type: "website" as const,
                  title: new URL(input.websiteUrl).hostname,
                  url: input.websiteUrl,
                },
              ]
            : []),
          ...(input.text
            ? [
                {
                  tenantId,
                  botId: bot.id,
                  type: "text" as const,
                  title: `About ${input.businessName}`,
                  content: input.text,
                },
              ]
            : []),
        ])
        .returning({ id: knowledgeSources.id });

      const [demo] = await tx
        .insert(demos)
        .values({ tenantId, botId: bot.id, note: input.note, createdBy: userId })
        .returning();
      await audit(tx, {
        tenantId,
        actorUserId: userId,
        action: "demo.created",
        targetType: "bot",
        targetId: bot.id,
        metadata: { pack: input.pack, variant: input.variant ?? null },
      });

      // Read the sources, then fill the page in (queued together with the demo).
      await tx.insert(jobs).values([
        ...sources.map((source) => ({
          tenantId,
          type: JOB_TYPES.sourceSync,
          payload: { sourceId: source.id } as Record<string, unknown>,
        })),
        {
          tenantId,
          type: JOB_TYPES.demoBuild,
          payload: { demoId: demo!.id } as Record<string, unknown>,
          runAt: new Date(Date.now() + DEMO_RETRY_MS),
        },
      ]);
      return { demo: demo!, bot, publicKey: key.publicKey };
    });

    await log(request, "demo.created", created.demo.id, {
      business: input.businessName,
      pack: input.pack,
      website: input.websiteUrl ?? null,
    });
    return reply.code(201).send({
      demo: {
        id: created.demo.id,
        tenantId: created.demo.tenantId,
        botId: created.bot.id,
        name: input.businessName,
        status: created.demo.status,
        pageUrl: `${config.PUBLIC_URL}/c/${created.publicKey}`,
      },
    });
  });

  app.post<IdParams>("/v1/operator/demos/:id/build", guard, async (request) => {
    const { demo, tenant } = await find(request.params.id);
    if (tenant.kind !== "demo") throw new HttpError(409, "demo_handed_over", "This demo was handed over");
    if (demo.status === "building") {
      throw new HttpError(409, "demo_building", "This demo is already being built");
    }
    await db.transaction(async (tx) => {
      await tx.update(demos).set({ status: "building", error: null }).where(eq(demos.id, demo.id));
      await tx.insert(jobs).values({
        tenantId: demo.tenantId,
        type: JOB_TYPES.demoBuild,
        payload: { demoId: demo.id },
      });
    });
    await log(request, "demo.rebuilt", demo.id, { business: tenant.name });
    return { demo: { id: demo.id, status: "building" as const } };
  });

  app.post<IdParams>("/v1/operator/demos/:id/hand-over", guard, async (request) => {
    const { demo, tenant } = await find(request.params.id);
    const { email } = handOverDemoSchema.parse(request.body);
    if (tenant.kind !== "demo") throw new HttpError(409, "demo_handed_over", "This demo was handed over");
    if (demo.status === "building") {
      throw new HttpError(409, "demo_building", "Wait until the demo is built");
    }
    const [owner] = await db
      .select({ id: users.id, platformRole: users.platformRole })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!owner) {
      throw new HttpError(
        404,
        "account_not_found",
        "No account uses this email yet. Ask the owner to sign up first, then hand the demo over.",
      );
    }
    if (owner.platformRole) throw badRequest("Staff accounts can't own businesses");
    const { maxBusinessesPerAccount } = await platform!.policies();

    await db.transaction(async (tx) => {
      // Same limit, and the same lock, as when an account adds a business itself.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tenant-owner:${owner.id}`}))`);
      const [owned] = await tx
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.userId, owner.id), eq(memberships.role, "owner")));
      if ((owned?.n ?? 0) >= maxBusinessesPerAccount) {
        throw new HttpError(
          403,
          "business_limit_reached",
          `This account already owns ${maxBusinessesPerAccount} businesses, the most an account can.`,
        );
      }
      await tx.insert(memberships).values({ tenantId: tenant.id, userId: owner.id, role: "owner" });
      await tx.update(tenants).set({ kind: "business" }).where(eq(tenants.id, tenant.id));
      await tx
        .update(demos)
        .set({ status: "handed_over", error: null, handedOverTo: email, handedOverAt: new Date() })
        .where(eq(demos.id, demo.id));
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
      await audit(tx, {
        tenantId: tenant.id,
        actorUserId: request.user!.id,
        action: "demo.handed_over",
        metadata: { ownerUserId: owner.id },
      });
    });
    await log(request, "demo.handed_over", demo.id, { business: tenant.name, to: email });
    return { demo: { id: demo.id, status: "handed_over" as const, handedOverTo: email } };
  });

  app.delete<IdParams>("/v1/operator/demos/:id", guard, async (request, reply) => {
    const { demo, tenant } = await find(request.params.id);
    // Only a demo is ever removed here: once handed over it is the owner's business.
    if (tenant.kind !== "demo") throw new HttpError(409, "demo_handed_over", "This demo was handed over");
    await db.delete(tenants).where(and(eq(tenants.id, tenant.id), eq(tenants.kind, "demo")));
    await log(request, "demo.deleted", demo.id, { business: tenant.name });
    return reply.code(204).send();
  });
}
