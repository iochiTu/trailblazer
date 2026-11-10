import { getAddon } from "./registry.js";
import type { AddonContext, AddonEffect, AddonEvent, AnyAddon, ChatLink } from "./types.js";

/** An add-on installed on an assistant, as stored (see `bot_addons`). */
export interface AddonInstallation {
  addonId: string;
  enabled: boolean;
  config: unknown;
  /** Add-on version that saved `config`. */
  configVersion: number;
}

/** An installed, enabled add-on with valid settings, ready to run. */
export interface ActiveAddon {
  addon: AnyAddon;
  config: unknown;
}

export type ConfigResult =
  | { ok: true; config: unknown }
  | { ok: false; issues: { path: string; message: string }[] };

/** Validates settings for an add-on (defaults filled in, unknown keys dropped). */
export function parseAddonConfig(addon: AnyAddon, input: unknown, fromVersion = addon.version): ConfigResult {
  const raw = fromVersion < addon.version && addon.migrate ? addon.migrate(input, fromVersion) : input;
  const result = addon.schema.safeParse({ ...(addon.defaults as object), ...(raw as object) });
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/**
 * The add-ons that run for an assistant: installed, turned on, still available, with settings that
 * still validate. Anything else is skipped quietly (the admin shows it as needing attention).
 */
export function activeAddons(installations: AddonInstallation[]): ActiveAddon[] {
  const active: ActiveAddon[] = [];
  for (const row of installations) {
    const addon = getAddon(row.addonId);
    if (!row.enabled || !addon || addon.status !== "available") continue;
    const parsed = parseAddonConfig(addon, row.config, row.configVersion);
    if (parsed.ok) active.push({ addon, config: parsed.config });
  }
  return active;
}

type Log = (msg: string, data?: Record<string, unknown>) => void;

/** Runs one hook per add-on; a failing add-on is logged and skipped so chat keeps working. */
function each<T>(active: ActiveAddon[], log: Log | undefined, fn: (a: ActiveAddon) => T | undefined): T[] {
  const out: T[] = [];
  for (const a of active) {
    try {
      const value = fn(a);
      if (value !== undefined) out.push(value);
    } catch (error) {
      log?.("add-on hook failed", {
        addonId: a.addon.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}

/** Text the add-ons add to the assistant's instructions, or null. */
export function addonPrompt(active: ActiveAddon[], ctx: AddonContext, log?: Log): string | null {
  const parts = each(active, log, (a) => a.addon.prompt?.(a.config, ctx) ?? undefined).filter(
    (text): text is string => !!text?.trim(),
  );
  return parts.length ? parts.join("\n\n") : null;
}

/** Chat page buttons from the add-ons (first one wins for a duplicated id). */
export function addonChatLinks(active: ActiveAddon[], ctx: AddonContext, log?: Log): ChatLink[] {
  const seen = new Set<string>();
  return each(active, log, (a) => a.addon.chatLinks?.(a.config, ctx))
    .flat()
    .filter((link) => !seen.has(link.id) && seen.add(link.id));
}

/** Effects the add-ons want for a chat event, tagged with the add-on that asked. */
export function addonEffects(
  active: ActiveAddon[],
  event: AddonEvent,
  ctx: AddonContext,
  log?: Log,
): { addonId: string; effect: AddonEffect }[] {
  return each(active, log, (a) =>
    (a.addon.onEvent?.(event, a.config, ctx) ?? []).map((effect) => ({ addonId: a.addon.id, effect })),
  ).flat();
}

/** True when any active add-on reacts to chat events (lets the chat skip the work otherwise). */
export const hasEventHandlers = (active: ActiveAddon[]) => active.some((a) => a.addon.onEvent);
