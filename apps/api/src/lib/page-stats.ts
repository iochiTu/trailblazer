import { type Db, pageStats, withTenant } from "@traiblazer/db";
import { type PageAction, REPORTING_TIME_ZONE } from "@traiblazer/shared";
import { sql } from "drizzle-orm";

/** Search engines, link previews and other robots: their visits aren't counted. */
const ROBOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|monitor|curl|wget|python|okhttp|java\//i;

/**
 * Whether a request is a person opening the business page: a top-level page load in a browser,
 * not a prefetch or a robot. Browsers send Sec-Fetch-Dest; most robots and scripts don't.
 */
export function isPersonVisit(headers: Record<string, string | string[] | undefined>): boolean {
  if (headers["sec-fetch-dest"] !== "document") return false;
  const purpose = `${headers["sec-purpose"] ?? ""} ${headers.purpose ?? ""} ${headers["x-moz"] ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  const agent = String(headers["user-agent"] ?? "");
  return agent.length > 0 && !ROBOT_RE.test(agent);
}

/** Adds one to today's count of page views or of taps on a contact button. */
export async function countPageEvent(
  db: Db,
  tenantId: string,
  botId: string,
  what: "views" | PageAction,
): Promise<void> {
  const day = sql`(now() at time zone ${REPORTING_TIME_ZONE})::date`;
  await withTenant(db, tenantId, (tx) =>
    tx
      .insert(pageStats)
      .values({ tenantId, botId, day, [what]: 1 })
      .onConflictDoUpdate({
        target: [pageStats.tenantId, pageStats.botId, pageStats.day],
        set: { [what]: sql`${pageStats[what]} + 1` },
      }),
  );
}
