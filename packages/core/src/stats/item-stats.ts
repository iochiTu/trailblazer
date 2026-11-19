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
 * Adds one to today's count for each service or product (docs/SELL_AND_PROMOTE.md §3.3): its button
 * was shown under an answer, tapped, or a request about it was passed on. One statement for all the
 * items. Must run inside withTenant(); the items must belong to the assistant (the caller checks).
 */
export async function countItemEvents(
  tx: Tx,
  input: {
    tenantId: string;
    botId: string;
    itemIds: Iterable<string>;
    surface: ItemStatSurface;
    event: ItemStatEvent;
  },
): Promise<void> {
  // Each item once: one insert can't update the same row twice.
  const itemIds = [...new Set(input.itemIds)];
  if (!itemIds.length) return;
  const day = sql`(now() at time zone ${REPORTING_TIME_ZONE})::date`;
  await tx
    .insert(itemStats)
    .values(
      itemIds.map((itemId) => ({
        tenantId: input.tenantId,
        botId: input.botId,
        itemId,
        surface: input.surface,
        day,
        [input.event]: 1,
      })),
    )
    .onConflictDoUpdate({
      target: [itemStats.tenantId, itemStats.botId, itemStats.itemId, itemStats.day, itemStats.surface],
      set: { [input.event]: sql`${itemStats[input.event]} + 1` },
    });
}
