import { type AddonEffect, getAddon } from "@traiblazer/addons";
import { botAddons, type Db, withTenant } from "@traiblazer/db";
import { and, eq } from "drizzle-orm";

/** Sends email. The worker picks the transport (SMTP, or the log in development). */
export interface Mailer {
  send(message: { to: string[]; subject: string; text: string }): Promise<void>;
}

export interface EffectDeps {
  db: Db;
  mailer: Mailer;
}

export interface AddonEffectPayload {
  botId: string;
  addonId: string;
  effect: AddonEffect;
}

/**
 * Runs one queued add-on effect. The add-on must still be installed and turned on when the job
 * runs: turning it off (or removing it) also stops work that was already queued.
 */
export async function runAddonEffect(
  deps: EffectDeps,
  tenantId: string,
  payload: AddonEffectPayload,
): Promise<"done" | "skipped"> {
  const addon = getAddon(payload.addonId);
  if (addon?.status !== "available") return "skipped";
  const [installed] = await withTenant(deps.db, tenantId, (tx) =>
    tx
      .select({ enabled: botAddons.enabled })
      .from(botAddons)
      .where(and(eq(botAddons.botId, payload.botId), eq(botAddons.addonId, payload.addonId)))
      .limit(1),
  );
  if (!installed?.enabled) return "skipped";

  const { effect } = payload;
  switch (effect.kind) {
    case "email":
      await deps.mailer.send({ to: effect.to, subject: effect.subject, text: effect.text });
      return "done";
    default: {
      const unknown: never = effect.kind;
      throw new Error(`Unknown add-on effect: ${String(unknown)}`);
    }
  }
}
