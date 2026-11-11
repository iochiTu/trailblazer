import { createHash } from "node:crypto";
import { assets, bots, catalogItems, notices, pageStats, withTenant } from "@traiblazer/db";
import {
  CATALOG_LIMIT,
  catalogPhotoSchema,
  createCatalogItemSchema,
  NOTICE_LIMIT,
  noticeSchema,
  PAGE_ACTIONS,
  REPORTING_TIME_ZONE,
  reorderCatalogSchema,
  updateCatalogItemSchema,
} from "@traiblazer/shared";
import { and, asc, count, eq, gte, max, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { prepareChatImage } from "../lib/images.js";
import { requireTenantRole } from "../plugins/auth.js";
import { publicAssetUrl } from "./assets.js";
import { lastDates } from "./usage.js";

type BotParams = { Params: { tenantId: string; botId: string } };
type ItemParams = { Params: { tenantId: string; botId: string; itemId: string } };

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/**
 * The business page's own content (PLAN §7.1), edited in the admin portal:
 *   /v1/tenants/:tenantId/bots/:botId/catalog        services and products (cards on the page)
 *   /v1/tenants/:tenantId/bots/:botId/notices        time-limited announcements
 *   /v1/tenants/:tenantId/bots/:botId/page-stats     views, contact taps, questions and requests
 * Page details (description, service area, credentials) are part of the business profile, and the
 * friendly link and layout are assistant settings (PATCH the assistant).
 */
export async function pageRoutes(app: FastifyInstance, { db, config }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots/:botId";

  /** Runs fn in the tenant's scope after checking the bot exists there. */
  const forBot = async <T>(tenantId: string, botId: string, fn: Parameters<typeof withTenant<T>>[2]) => {
    if (!isUuid(botId)) throw notFound("Assistant");
    return withTenant(db, tenantId, async (tx) => {
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      return fn(tx);
    });
  };

  const withPhotoUrl = <T extends { assetId: string | null }>(row: T) => ({
    ...row,
    photoUrl: row.assetId ? publicAssetUrl(config.PUBLIC_URL, row.assetId) : null,
  });

  // ---- Services & products ------------------------------------------------------------------

  app.get<BotParams>(`${base}/catalog`, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { tenantId, botId } = request.params;
    const rows = await forBot(tenantId, botId, (tx) =>
      tx
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.botId, botId))
        .orderBy(asc(catalogItems.position), asc(catalogItems.createdAt)),
    );
    return { items: rows.map(withPhotoUrl), limit: CATALOG_LIMIT };
  });

  app.post<BotParams>(
    `${base}/catalog`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId } = request.params;
      const input = createCatalogItemSchema.parse(request.body);
      const item = await forBot(tenantId, botId, async (tx) => {
        const [stats] = await tx
          .select({ n: count(), last: max(catalogItems.position) })
          .from(catalogItems)
          .where(eq(catalogItems.botId, botId));
        if ((stats?.n ?? 0) >= CATALOG_LIMIT) {
          throw new HttpError(
            409,
            "catalog_limit",
            `An assistant can list up to ${CATALOG_LIMIT} services and products`,
          );
        }
        const [row] = await tx
          .insert(catalogItems)
          .values({ tenantId, botId, ...input, position: (stats?.last ?? -1) + 1 })
          .returning();
        await audit(tx, {
          tenantId,
          actorUserId: request.user?.id ?? null,
          action: "catalog_item.create",
          targetType: "catalog_item",
          targetId: row!.id,
        });
        return row!;
      });
      return reply.code(201).send({ item: withPhotoUrl(item) });
    },
  );

  app.patch<ItemParams>(
    `${base}/catalog/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Service");
      const input = updateCatalogItemSchema.parse(request.body);
      const item = await forBot(tenantId, botId, async (tx) => {
        const [row] = await tx
          .update(catalogItems)
          .set(input)
          .where(and(eq(catalogItems.id, itemId), eq(catalogItems.botId, botId)))
          .returning();
        if (!row) throw notFound("Service");
        return row;
      });
      return { item: withPhotoUrl(item) };
    },
  );

  app.delete<ItemParams>(
    `${base}/catalog/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Service");
      await forBot(tenantId, botId, async (tx) => {
        const [row] = await tx
          .delete(catalogItems)
          .where(and(eq(catalogItems.id, itemId), eq(catalogItems.botId, botId)))
          .returning({ assetId: catalogItems.assetId });
        if (!row) throw notFound("Service");
        // Its photo stops being public too.
        if (row.assetId) await tx.delete(assets).where(eq(assets.id, row.assetId));
        await audit(tx, {
          tenantId,
          actorUserId: request.user?.id ?? null,
          action: "catalog_item.delete",
          targetType: "catalog_item",
          targetId: itemId,
        });
      });
      return reply.code(204).send();
    },
  );

  /** New order of the cards: every item's id, first card first. */
  app.post<BotParams>(
    `${base}/catalog/order`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { tenantId, botId } = request.params;
      const { ids } = reorderCatalogSchema.parse(request.body);
      const rows = await forBot(tenantId, botId, async (tx) => {
        const current = await tx
          .select({ id: catalogItems.id })
          .from(catalogItems)
          .where(eq(catalogItems.botId, botId));
        const known = new Set(current.map((r) => r.id));
        if (
          ids.length !== known.size ||
          new Set(ids).size !== ids.length ||
          !ids.every((id) => known.has(id))
        ) {
          throw badRequest("Send every service and product of this assistant, once each");
        }
        for (const [position, id] of ids.entries()) {
          await tx.update(catalogItems).set({ position }).where(eq(catalogItems.id, id));
        }
        return tx
          .select()
          .from(catalogItems)
          .where(eq(catalogItems.botId, botId))
          .orderBy(asc(catalogItems.position));
      });
      return { items: rows.map(withPhotoUrl), limit: CATALOG_LIMIT };
    },
  );

  app.put<ItemParams>(
    `${base}/catalog/:itemId/photo`,
    {
      preHandler: requireTenantRole(db, "editor"),
      bodyLimit: Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 16 * 1024,
    },
    async (request) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Service");
      const { data } = catalogPhotoSchema.parse(request.body);
      const prepared = prepareChatImage(data, MAX_PHOTO_BYTES);
      if (!prepared.ok) {
        throw badRequest(
          prepared.reason === "size"
            ? "Photos must be smaller than 2 MB"
            : "Please upload a PNG, JPEG or WebP image",
        );
      }
      const item = await forBot(tenantId, botId, async (tx) => {
        const [current] = await tx
          .select({ assetId: catalogItems.assetId })
          .from(catalogItems)
          .where(and(eq(catalogItems.id, itemId), eq(catalogItems.botId, botId)))
          .limit(1);
        if (!current) throw notFound("Service");
        const [asset] = await tx
          .insert(assets)
          .values({
            tenantId,
            kind: "catalog_image",
            contentType: prepared.contentType,
            bytes: prepared.bytes,
            sizeBytes: prepared.bytes.length,
            sha256: createHash("sha256").update(prepared.bytes).digest("hex"),
          })
          .returning({ id: assets.id });
        const [row] = await tx
          .update(catalogItems)
          .set({ assetId: asset!.id })
          .where(eq(catalogItems.id, itemId))
          .returning();
        if (current.assetId) await tx.delete(assets).where(eq(assets.id, current.assetId));
        return row!;
      });
      return { item: withPhotoUrl(item) };
    },
  );

  app.delete<ItemParams>(
    `${base}/catalog/:itemId/photo`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Service");
      const item = await forBot(tenantId, botId, async (tx) => {
        const [current] = await tx
          .select({ assetId: catalogItems.assetId })
          .from(catalogItems)
          .where(and(eq(catalogItems.id, itemId), eq(catalogItems.botId, botId)))
          .limit(1);
        if (!current) throw notFound("Service");
        if (current.assetId) await tx.delete(assets).where(eq(assets.id, current.assetId));
        const [row] = await tx.select().from(catalogItems).where(eq(catalogItems.id, itemId));
        return row!;
      });
      return { item: withPhotoUrl(item) };
    },
  );

  // ---- Statistics ---------------------------------------------------------------------------

  /**
   * How the page is doing over the last `days` days (by day in the reporting time zone): page views
   * and taps on its contact buttons, questions visitors asked the assistant (on the page and on the
   * business's website) and requests they left. The owner's own tests are left out.
   */
  app.get<BotParams & { Querystring: { days?: string } }>(
    `${base}/page-stats`,
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const { tenantId, botId } = request.params;
      const days = Math.min(Math.max(Number(request.query.days) || 30, 7), 90);
      const dates = lastDates(days);
      const first = dates[0]!;
      const tz = REPORTING_TIME_ZONE;
      const since = sql`(${first}::date::timestamp at time zone ${tz})`;

      const report = await forBot(tenantId, botId, async (tx) => {
        const page = await tx
          .select()
          .from(pageStats)
          .where(and(eq(pageStats.botId, botId), gte(pageStats.day, first)));
        const chats = await tx.execute<{ day: string; questions: number; conversations: number }>(sql`
          select to_char(m.created_at at time zone ${tz}, 'YYYY-MM-DD') as day,
                 count(*)::int as questions,
                 count(distinct m.conversation_id)::int as conversations
          from messages m join conversations c on c.id = m.conversation_id
          where c.bot_id = ${botId} and c.channel <> 'playground' and m.role = 'user'
            and m.created_at >= ${since}
          group by 1`);
        const requests = await tx.execute<{ day: string; requests: number; urgent: number }>(sql`
          select to_char(created_at at time zone ${tz}, 'YYYY-MM-DD') as day,
                 count(*)::int as requests,
                 count(*) filter (where urgent)::int as urgent
          from leads
          where bot_id = ${botId} and channel <> 'playground' and created_at >= ${since}
          group by 1`);
        return { page, chats, requests };
      });

      const pageByDay = new Map(report.page.map((r) => [r.day, r]));
      const chatsByDay = new Map(report.chats.map((r) => [r.day, r]));
      const requestsByDay = new Map(report.requests.map((r) => [r.day, r]));
      const taps = Object.fromEntries(
        PAGE_ACTIONS.map((action) => [action, report.page.reduce((sum, r) => sum + r[action], 0)]),
      ) as Record<(typeof PAGE_ACTIONS)[number], number>;
      const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((n, r) => n + pick(r), 0);

      return {
        days,
        totals: {
          views: sum(report.page, (r) => r.views),
          taps,
          questions: sum(report.chats, (r) => r.questions),
          conversations: sum(report.chats, (r) => r.conversations),
          requests: sum(report.requests, (r) => r.requests),
          urgentRequests: sum(report.requests, (r) => r.urgent),
        },
        daily: dates.map((date) => {
          const page = pageByDay.get(date);
          return {
            date,
            views: page?.views ?? 0,
            taps: page ? PAGE_ACTIONS.reduce((n, action) => n + page[action], 0) : 0,
            questions: chatsByDay.get(date)?.questions ?? 0,
            requests: requestsByDay.get(date)?.requests ?? 0,
          };
        }),
      };
    },
  );

  // ---- Notices ------------------------------------------------------------------------------

  const toNoticeValues = (input: ReturnType<typeof noticeSchema.parse>) => ({
    text: input.text,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  });

  app.get<BotParams>(`${base}/notices`, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { tenantId, botId } = request.params;
    const rows = await forBot(tenantId, botId, (tx) =>
      tx.select().from(notices).where(eq(notices.botId, botId)).orderBy(asc(notices.createdAt)),
    );
    return { notices: rows, limit: NOTICE_LIMIT };
  });

  app.post<BotParams>(
    `${base}/notices`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId } = request.params;
      const input = noticeSchema.parse(request.body);
      const notice = await forBot(tenantId, botId, async (tx) => {
        const [used] = await tx.select({ n: count() }).from(notices).where(eq(notices.botId, botId));
        if ((used?.n ?? 0) >= NOTICE_LIMIT) {
          throw new HttpError(409, "notice_limit", `An assistant can have up to ${NOTICE_LIMIT} notices`);
        }
        const [row] = await tx
          .insert(notices)
          .values({ tenantId, botId, ...toNoticeValues(input) })
          .returning();
        return row!;
      });
      return reply.code(201).send({ notice });
    },
  );

  app.put<ItemParams>(
    `${base}/notices/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Notice");
      const input = noticeSchema.parse(request.body);
      const notice = await forBot(tenantId, botId, async (tx) => {
        const [row] = await tx
          .update(notices)
          .set(toNoticeValues(input))
          .where(and(eq(notices.id, itemId), eq(notices.botId, botId)))
          .returning();
        if (!row) throw notFound("Notice");
        return row;
      });
      return { notice };
    },
  );

  app.delete<ItemParams>(
    `${base}/notices/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Notice");
      await forBot(tenantId, botId, async (tx) => {
        const deleted = await tx
          .delete(notices)
          .where(and(eq(notices.id, itemId), eq(notices.botId, botId)))
          .returning({ id: notices.id });
        if (!deleted.length) throw notFound("Notice");
      });
      return reply.code(204).send();
    },
  );
}
