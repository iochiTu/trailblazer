import { type AddonEffect, getAddon } from "@traiblazer/addons";
import { botAddons, type Db, withTenant } from "@traiblazer/db";
import type { IntegrationsConfig } from "@traiblazer/integrations";
import { and, eq } from "drizzle-orm";
import { pushLeadToCrm } from "../integrations/crm.js";

/** Sends email. The worker picks the transport (SMTP, or the log in development). */
export interface Mailer {
  send(message: { to: string[]; subject: string; text: string }): Promise<void>;
}

export interface EffectDeps {
  db: Db;
  mailer: Mailer;
  /** CRM connections. Without it (or without a secret key) CRM effects are skipped. */
  integrations?: IntegrationsConfig;
  /** Outbound HTTP for CRM calls (tests pass a fake). */
  fetch?: typeof fetch;
  /** Admin portal origin, for links back to the request. */
  adminUrl?: string;
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
): Promise<"done" | "skipped" | "failed"> {
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
    case "crm.lead":
      if (!deps.integrations) return "skipped";
      return pushLeadToCrm(
        { db: deps.db, integrations: deps.integrations, fetch: deps.fetch, adminUrl: deps.adminUrl },
        tenantId,
        { botId: payload.botId, provider: effect.provider, leadId: effect.leadId },
      );
    default: {
      const unknown: never = effect;
      throw new Error(`Unknown add-on effect: ${String((unknown as { kind?: string }).kind)}`);
    }
  }
}
