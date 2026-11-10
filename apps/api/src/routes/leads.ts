import { bots, leads, withTenant } from "@traiblazer/db";
import { LEAD_STATUSES, updateLeadSchema } from "@traiblazer/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string }; Querystring: { status?: string } };
type LeadParams = { Params: { tenantId: string; botId: string; leadId: string } };

/**
 * Requests visitors left with the assistant (contact details + what they want):
 *   GET    /v1/tenants/:t/bots/:b/leads[?status=new]     newest first, with how many are new
 *   PATCH  /v1/tenants/:t/bots/:b/leads/:leadId          move to new / in_progress / done
 *   DELETE /v1/tenants/:t/bots/:b/leads/:leadId          remove (e.g. on the visitor's request)
 *
 * Every member can read them; changing or removing one needs the editor role and is audited
 * (without the visitor's details).
 */
export async function leadRoutes(app: FastifyInstance, { db }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots/:botId/leads";

  app.get<BotParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { botId } = request.params;
    const { status } = request.query;
    if (!isUuid(botId)) throw notFound("Assistant");
    if (status !== undefined && !LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number])) {
      throw badRequest("Unknown status");
    }
    return withTenant(db, request.tenant!.id, async (tx) => {
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      const list = await tx
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.botId, botId),
            status ? eq(leads.status, status as (typeof LEAD_STATUSES)[number]) : undefined,
          ),
        )
        .orderBy(desc(leads.createdAt))
        .limit(200);
      const [counts] = await tx
        .select({ newCount: sql<number>`count(*) filter (where ${leads.status} = 'new')::int` })
        .from(leads)
        .where(eq(leads.botId, botId));
      return { leads: list, newCount: counts?.newCount ?? 0 };
    });
  });

  app.patch<LeadParams>(
    `${base}/:leadId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { botId, leadId } = request.params;
      if (!isUuid(botId) || !isUuid(leadId)) throw notFound("Request");
      const { status } = updateLeadSchema.parse(request.body);
      return withTenant(db, request.tenant!.id, async (tx) => {
        const [lead] = await tx
          .update(leads)
          .set({ status })
          .where(and(eq(leads.id, leadId), eq(leads.botId, botId)))
          .returning();
        if (!lead) throw notFound("Request");
        await audit(tx, {
          tenantId: request.tenant!.id,
          actorUserId: request.user?.id ?? null,
          action: "lead.update",
          targetType: "lead",
          targetId: leadId,
          metadata: { status },
        });
        return { lead };
      });
    },
  );

  app.delete<LeadParams>(
    `${base}/:leadId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { botId, leadId } = request.params;
      if (!isUuid(botId) || !isUuid(leadId)) throw notFound("Request");
      await withTenant(db, request.tenant!.id, async (tx) => {
        const [lead] = await tx
          .delete(leads)
          .where(and(eq(leads.id, leadId), eq(leads.botId, botId)))
          .returning({ id: leads.id });
        if (!lead) throw notFound("Request");
        await audit(tx, {
          tenantId: request.tenant!.id,
          actorUserId: request.user?.id ?? null,
          action: "lead.delete",
          targetType: "lead",
          targetId: leadId,
        });
      });
      return reply.code(204).send();
    },
  );
}
