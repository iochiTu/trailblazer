import { activeAddons } from "@traiblazer/addons";
import { botAddons, catalogItems, notices, type Tx } from "@traiblazer/db";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";

/** What the business is called: its profile's name, or the assistant's until a profile exists. */
export const businessNameOf = (
  bot: { name: string },
  profile: { businessName: string | null } | null | undefined,
) => profile?.businessName ?? bot.name;

/** A notice or promotion running at `at`: started (or no start date) and not yet ended. */
export const noticeRunsAt = (at: Date) =>
  and(
    or(isNull(notices.startsAt), lte(notices.startsAt, at)),
    or(isNull(notices.endsAt), gt(notices.endsAt, at)),
  );

/** The assistant's notices and promotions running at `at`, oldest first. */
export async function runningNotices(tx: Tx, botId: string, at: Date) {
  const running = await tx
    .select({
      id: notices.id,
      text: notices.text,
      kind: notices.kind,
      title: notices.title,
      endsAt: notices.endsAt,
      itemId: notices.catalogItemId,
    })
    .from(notices)
    .where(and(eq(notices.botId, botId), noticeRunsAt(at)))
    .orderBy(asc(notices.createdAt));
  return {
    /** Plain notices, in the owner's words. */
    notices: running.filter((n) => n.kind !== "offer").map((n) => n.text),
    offers: running.filter((n) => n.kind === "offer"),
  };
}

/** The services and products the owner lists (turned on), in the owner's order. */
export const listedCatalogItems = (tx: Tx, botId: string) =>
  tx
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.botId, botId), eq(catalogItems.enabled, true)))
    .orderBy(asc(catalogItems.position), asc(catalogItems.createdAt));

/** The add-ons that run for an assistant (see `activeAddons`). */
export async function installedAddons(tx: Tx, botId: string) {
  return activeAddons(
    await tx
      .select({
        addonId: botAddons.addonId,
        enabled: botAddons.enabled,
        config: botAddons.config,
        configVersion: botAddons.configVersion,
      })
      .from(botAddons)
      .where(eq(botAddons.botId, botId)),
  );
}
