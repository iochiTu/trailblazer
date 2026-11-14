import { type Channel, type ItemStatSurface, itemStats, type Tx } from "@traiblazer/db";
import { REPORTING_TIME_ZONE } from "@traiblazer/shared";
import { sql } from "drizzle-orm";

export type ItemStatEvent = "shown" | "tapped" | "requested";

/** Which column of the statistics a conversation counts under; null for the owner's own tests. */
export function itemStatSurface(channel: Channel): ItemStatSurface | null {
  if (channel === "playground") return null;
  return channel === "sms" ? "sms" : "chat";
}

/**
 * Adds one to today's count for a service or product (docs/SELL_AND_PROMOTE.md §3.3): its button
 * was shown under an answer, tapped, or a request about it was passed on. Must run inside
 * withTenant(); the item must belong to the assistant (the caller checks).
 */
export async function countItemEvent(
  tx: Tx,
  input: { tenantId: string; botId: string; itemId: string; surface: ItemStatSurface; event: ItemStatEvent },
): Promise<void> {
  const day = sql`(now() at time zone ${REPORTING_TIME_ZONE})::date`;
  await tx
    .insert(itemStats)
    .values({
      tenantId: input.tenantId,
      botId: input.botId,
      itemId: input.itemId,
      surface: input.surface,
      day,
      [input.event]: 1,
    })
    .onConflictDoUpdate({
      target: [itemStats.tenantId, itemStats.botId, itemStats.itemId, itemStats.day, itemStats.surface],
      set: { [input.event]: sql`${itemStats[input.event]} + 1` },
    });
}
