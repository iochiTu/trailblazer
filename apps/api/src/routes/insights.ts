import { planAllows } from "@traiblazer/core";
import { bots, type Tx, withTenant } from "@traiblazer/db";
import { PAGE_ACTIONS, REPORTING_TIME_ZONE } from "@traiblazer/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";
import { lastDates } from "./usage.js";

type BotParams = { Params: { tenantId: string; botId: string }; Querystring: { days?: string } };

/** Where a conversation happened, as owners think of it. */
const CHANNEL_GROUP = sql`case channel when 'hosted' then 'page' when 'sms' then 'sms' else 'website' end`;

export interface Funnel {
  views: number;
  conversations: number;
  offered: number;
  taps: number;
  requests: number;
}

/** The day before a YYYY-MM-DD date. */
const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Funnel from page views to requests between two days (inclusive, reporting time zone). The
 * owner's own tests are left out.
 */
async function funnel(tx: Tx, botId: string, from: string, to: string): Promise<Funnel> {
  const tz = REPORTING_TIME_ZONE;
  const since = sql`(${from}::date::timestamp at time zone ${tz})`;
  const until = sql`((${to}::date + 1)::timestamp at time zone ${tz})`;
  const pageTaps = sql.raw(PAGE_ACTIONS.map((a) => `coalesce(sum("${a}"), 0)`).join(" + "));
  const [row] = await tx.execute<{
    views: number;
    page_taps: number;
    conversations: number;
    offered: number;
    item_taps: number;
    requests: number;
  }>(sql`
    select
      (select coalesce(sum(views), 0)::int from page_stats
        where bot_id = ${botId} and day between ${from}::date and ${to}::date) as views,
      (select (${pageTaps})::int from page_stats
        where bot_id = ${botId} and day between ${from}::date and ${to}::date) as page_taps,
      (select count(distinct m.conversation_id)::int
         from messages m join conversations c on c.id = m.conversation_id
        where c.bot_id = ${botId} and c.channel <> 'playground' and m.role = 'user'
          and m.created_at >= ${since} and m.created_at < ${until}) as conversations,
      (select coalesce(sum(shown), 0)::int from item_stats
        where bot_id = ${botId} and day between ${from}::date and ${to}::date) as offered,
      (select coalesce(sum(tapped), 0)::int from item_stats
        where bot_id = ${botId} and day between ${from}::date and ${to}::date) as item_taps,
      (select count(*)::int from leads
        where bot_id = ${botId} and channel <> 'playground'
          and created_at >= ${since} and created_at < ${until}) as requests`);
  return {
    views: row?.views ?? 0,
    conversations: row?.conversations ?? 0,
    offered: row?.offered ?? 0,
    taps: (row?.page_taps ?? 0) + (row?.item_taps ?? 0),
    requests: row?.requests ?? 0,
  };
}

/**
 * Insights (premium BI) for one assistant: the funnel from page views to requests with the
 * previous period for comparison, conversion by channel and language, what visitors want, why
 * they didn't convert, how they felt, and when they write. Daily totals only (PLAN.md §18.4).
 *   GET /v1/tenants/:tenantId/bots/:botId/insights?days=30
 */
export async function insightsRoutes(app: FastifyInstance, { db }: AppContext) {
  app.get<BotParams>(
    "/v1/tenants/:tenantId/bots/:botId/insights",
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const { tenantId, botId } = request.params;
      if (!isUuid(botId)) throw notFound("Assistant");
      const days = Math.min(Math.max(Number(request.query.days) || 30, 7), 90);
      const dates = lastDates(days);
      const first = dates[0]!;
      const last = dates.at(-1)!;
      const previous = lastDates(days, new Date(`${dayBefore(first)}T12:00:00Z`));
      const tz = REPORTING_TIME_ZONE;
      const since = sql`(${first}::date::timestamp at time zone ${tz})`;

      return withTenant(db, tenantId, async (tx) => {
        const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
        if (!bot) throw notFound("Assistant");
        if (!(await planAllows(tx, tenantId, "insights"))) {
          throw new HttpError(403, "plan_required", "Insights isn't part of this business's plan");
        }

        // One connection per transaction: the queries run one after the other.
        const current = await funnel(tx, botId, first, last);
        const before = await funnel(tx, botId, previous[0]!, previous.at(-1)!);

        // Conversations and requests by channel and by language.
        const channels = await tx.execute<{ channel: string; conversations: number; requests: number }>(sql`
          with c as (
            select ${CHANNEL_GROUP} as channel, count(*)::int as n from conversations
             where bot_id = ${botId} and channel <> 'playground' and created_at >= ${since}
               and message_count > 0
             group by 1),
          l as (
            select ${CHANNEL_GROUP} as channel, count(*)::int as n from leads
             where bot_id = ${botId} and channel <> 'playground' and created_at >= ${since}
             group by 1)
          select coalesce(c.channel, l.channel) as channel,
                 coalesce(c.n, 0) as conversations, coalesce(l.n, 0) as requests
            from c full join l on l.channel = c.channel
           order by 2 desc`);
        const languages = await tx.execute<{ language: string; conversations: number; requests: number }>(sql`
          with c as (
            select coalesce(language, 'unknown') as language, count(*)::int as n from conversations
             where bot_id = ${botId} and channel <> 'playground' and created_at >= ${since}
               and message_count > 0
             group by 1),
          l as (
            -- A request counts under its conversation's language, so the two columns match.
            select coalesce(cv.language, leads.language, 'unknown') as language, count(*)::int as n
              from leads left join conversations cv on cv.id = leads.conversation_id
             where leads.bot_id = ${botId} and leads.channel <> 'playground' and leads.created_at >= ${since}
             group by 1)
          select coalesce(c.language, l.language) as language,
                 coalesce(c.n, 0) as conversations, coalesce(l.n, 0) as requests
            from c full join l on l.language = c.language
           order by 2 desc
           limit 8`);

        // The tags of analyzed conversations.
        const tags = await tx.execute<{ dimension: string; value: string; n: number }>(sql`
          select dimension, value, sum(count)::int as n from conversation_insights
           where bot_id = ${botId} and day between ${first}::date and ${last}::date
           group by 1, 2`);
        const sentimentRows = await tx.execute<{ day: string; value: string; n: number }>(sql`
          select to_char(day, 'YYYY-MM-DD') as day, value, sum(count)::int as n from conversation_insights
           where bot_id = ${botId} and dimension = 'sentiment'
             and day between ${first}::date and ${last}::date
           group by 1, 2`);

        // Questions by weekday (1 = Monday) and hour, in the reporting time zone.
        const busy = await tx.execute<{ weekday: number; hour: number; n: number }>(sql`
          select extract(isodow from m.created_at at time zone ${tz})::int as weekday,
                 extract(hour from m.created_at at time zone ${tz})::int as hour,
                 count(*)::int as n
            from messages m join conversations c on c.id = m.conversation_id
           where c.bot_id = ${botId} and c.channel <> 'playground' and m.role = 'user'
             and m.created_at >= ${since}
           group by 1, 2`);

        const [gaps] = await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from knowledge_gaps where bot_id = ${botId} and status = 'open'`);

        const byDimension = (dimension: string) =>
          Object.fromEntries(tags.filter((t) => t.dimension === dimension).map((t) => [t.value, t.n]));
        const intents = byDimension("intent");
        const intentRequests = byDimension("intent_request");
        const outcomes = byDimension("outcome");
        const sentimentByDay = new Map<string, Record<string, number>>();
        for (const row of sentimentRows) {
          sentimentByDay.set(row.day, { ...sentimentByDay.get(row.day), [row.value]: row.n });
        }

        return {
          days,
          funnel: { current, previous: before },
          channels: [...channels],
          languages: [...languages],
          analyzed: Object.values(outcomes).reduce((n, v) => n + v, 0),
          outcomes,
          intents: Object.entries(intents)
            .map(([intent, conversations]) => ({
              intent,
              conversations,
              requests: intentRequests[intent] ?? 0,
            }))
            .sort((a, b) => b.conversations - a.conversations),
          blockers: byDimension("blocker"),
          sentiment: dates.map((date) => {
            const day = sentimentByDay.get(date) ?? {};
            return {
              date,
              positive: day.positive ?? 0,
              neutral: day.neutral ?? 0,
              negative: day.negative ?? 0,
            };
          }),
          busyTimes: [...busy],
          openGaps: gaps?.n ?? 0,
        };
      });
    },
  );
}
