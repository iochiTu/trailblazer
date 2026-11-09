import { tenants, withTenant } from "@traiblazer/db";
import { effectiveMonthlyLimit, REPORTING_TIME_ZONE, updateLimitsSchema } from "@traiblazer/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { currentUsage } from "../lib/chat-guard.js";
import { badRequest, notFound } from "../lib/errors.js";
import { hasRole, requireTenantRole } from "../plugins/auth.js";

type TenantParams = { Params: { tenantId: string } };

/**
 * Last `days` calendar dates (YYYY-MM-DD) in the reporting time zone, oldest first. Steps back by
 * calendar day from today's local date, so daylight-saving changes (23- and 25-hour days) never
 * skip or repeat a date.
 */
export function lastDates(days: number, now = new Date()): string[] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIME_ZONE }).format(now);
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(year, month - 1, day - i)).toISOString().slice(0, 10));
  }
  return out;
}

/** Usage report and limit settings for one business (PLAN §16; abuse & noisy-neighbour limits). */
export async function usageRoutes(app: FastifyInstance, { db, config, platform }: AppContext) {
  app.get<TenantParams & { Querystring: { days?: string } }>(
    "/v1/tenants/:tenantId/usage",
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const tenantId = request.tenant!.id;
      const days = Math.min(Math.max(Number(request.query.days) || 30, 7), 90);
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      if (!tenant) throw notFound("Business");
      const [plan, policies] = await Promise.all([platform!.plan(tenant.plan), platform!.policies()]);
      const limit = effectiveMonthlyLimit(plan.monthlyQuestions, tenant.monthlyQuestionLimit);
      const month = await currentUsage(db, tenantId);
      const tz = REPORTING_TIME_ZONE;
      const monthStart = sql`(date_trunc('month', now() at time zone ${tz}) at time zone ${tz})`;

      const report = await withTenant(db, tenantId, async (tx) => {
        const daily = await tx.execute<{ day: string; questions: number; conversations: number }>(sql`
          select to_char(m.created_at at time zone ${tz}, 'YYYY-MM-DD') as day,
                 count(*) filter (where m.role = 'user')::int as questions,
                 count(distinct m.conversation_id)::int as conversations
          from messages m
          where m.created_at >= now() - make_interval(days => ${days})
          group by 1`);
        const byAssistant = await tx.execute<{ bot_id: string; name: string; questions: number }>(sql`
          select b.id as bot_id, b.name, count(m.id)::int as questions
          from bots b
          left join conversations c on c.bot_id = b.id
          left join messages m on m.conversation_id = c.id and m.role = 'user' and m.created_at >= ${monthStart}
          group by b.id, b.name
          order by questions desc, b.name`);
        const byChannel = await tx.execute<{ channel: string; questions: number }>(sql`
          select c.channel, count(*)::int as questions
          from messages m join conversations c on c.id = m.conversation_id
          where m.role = 'user' and m.created_at >= ${monthStart}
          group by c.channel
          order by questions desc`);
        const [cost] = await tx.execute<{ micros: string | null }>(sql`
          select sum(cost_micros)::bigint as micros from usage_events where created_at >= ${monthStart}`);
        // Add the month in local time, then convert: avoids a one-hour shift across DST changes.
        const [period] = await tx.execute<{ resets_at: string }>(
          sql`select ((date_trunc('month', now() at time zone ${tz}) + interval '1 month') at time zone ${tz}) as resets_at`,
        );
        return {
          daily,
          byAssistant,
          byChannel,
          costMicros: Number(cost?.micros ?? 0),
          resetsAt: period!.resets_at,
        };
      });

      const byDay = new Map(report.daily.map((d) => [d.day, d]));
      const canSeeCost = hasRole(request.tenant!.role, "admin");

      return {
        plan,
        limits: {
          monthlyQuestionLimit: tenant.monthlyQuestionLimit,
          effectiveMonthlyLimit: limit,
          visitorDailyLimit: tenant.visitorDailyLimit,
          defaultVisitorDailyLimit: policies.visitorDailyLimit,
          maxConversationQuestions: config.CONVERSATION_MAX_QUESTIONS ?? policies.conversationMaxQuestions,
        },
        month: {
          period: month.period,
          resetsAt: new Date(report.resetsAt).toISOString(),
          questions: month.questions,
          remaining: Math.max(0, limit - month.questions),
          blockedQuota: month.blockedQuota,
          blockedBusy: month.blockedBusy,
          blockedVisitor: month.blockedVisitor,
          // AI cost is commercially sensitive: owners and admins only.
          costMicros: canSeeCost ? report.costMicros : null,
        },
        daily: lastDates(days).map((date) => ({
          date,
          questions: byDay.get(date)?.questions ?? 0,
          conversations: byDay.get(date)?.conversations ?? 0,
        })),
        byAssistant: report.byAssistant.map((r) => ({
          botId: r.bot_id,
          name: r.name,
          questions: r.questions,
        })),
        byChannel: report.byChannel,
      };
    },
  );

  app.patch<TenantParams>(
    "/v1/tenants/:tenantId/limits",
    { preHandler: requireTenantRole(db, "admin") },
    async (request) => {
      const tenantId = request.tenant!.id;
      const input = updateLimitsSchema.parse(request.body);
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      if (!tenant) throw notFound("Business");
      const planMax = (await platform!.plan(tenant.plan)).monthlyQuestions;
      if (input.monthlyQuestionLimit && input.monthlyQuestionLimit > planMax) {
        throw badRequest(`Your plan includes up to ${planMax} questions per month`);
      }
      const [updated] = await db.update(tenants).set(input).where(eq(tenants.id, tenantId)).returning({
        monthlyQuestionLimit: tenants.monthlyQuestionLimit,
        visitorDailyLimit: tenants.visitorDailyLimit,
      });
      await withTenant(db, tenantId, (tx) =>
        audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: "limits.updated",
          metadata: { ...input },
        }),
      );
      return { limits: updated };
    },
  );
}
