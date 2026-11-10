import type { z } from "zod";

/**
 * Add-on contract. An add-on is a self-contained extension a business installs on one assistant
 * from the add-on market. It never talks to the database or the network itself: it only
 *
 *   - adds text to the assistant's instructions (`prompt`),
 *   - adds buttons to the chat page (`chatLinks`),
 *   - turns chat events into effects (`onEvent`), which the platform runs later through the job
 *     queue (for example sending an email).
 *
 * Keeping hooks pure makes add-ons easy to test and keeps the chat fast and safe: an add-on that
 * throws is skipped, never breaking an answer. New integrations (catalog feeds, booking APIs,
 * webhooks) plug in by adding hook kinds, event types or effect kinds here.
 */

/** Text shown to business owners, in the admin portal's languages. */
export interface Localized {
  en: string;
  fr: string;
}

export const ADDON_CATEGORIES = [
  "notifications",
  "commerce",
  "booking",
  "marketing",
  "productivity",
] as const;
export type AddonCategory = (typeof ADDON_CATEGORIES)[number];

/** "coming_soon" add-ons are listed in the market but can't be installed yet. */
export type AddonStatus = "available" | "coming_soon";

/** What an add-on does with the assistant, listed in the market before the owner installs it. */
export type AddonCapability =
  /** Adds information or instructions to the assistant's answers. */
  | "prompt"
  /** Shows buttons on the chat page. */
  | "chat_links"
  /** Sends notifications to the business (email today; SMS later). */
  | "notifications";

/** A setting the owner fills in; the admin portal renders the form from these. */
export type AddonField =
  | {
      key: string;
      type: "text" | "email" | "url" | "textarea";
      label: Localized;
      hint?: Localized;
      placeholder?: string;
      required?: boolean;
      maxLength?: number;
    }
  | { key: string; type: "toggle"; label: Localized; hint?: Localized }
  | {
      key: string;
      type: "select";
      label: Localized;
      hint?: Localized;
      options: { value: string; label: Localized }[];
    };

/** About the assistant an add-on runs for. */
export interface AddonContext {
  tenantId: string;
  botId: string;
  businessName: string;
  /** Language the business owner reads (notifications are written in it). */
  ownerLanguage: "en" | "fr";
  /** Admin portal origin, for links in notifications. */
  adminUrl?: string;
}

/** Things that happen in a chat, delivered to add-ons after the answer is stored. */
export type AddonEvent =
  | {
      type: "conversation.started";
      conversationId: string;
      channel: string;
      language: string | null;
      /** The visitor's first message (may be empty when they only sent images). */
      message: string;
      at: Date;
    }
  | {
      type: "question.unanswered";
      conversationId: string;
      language: string | null;
      question: string;
      answer: string;
      at: Date;
    }
  | {
      /** A visitor left a request for the business to follow up on (see `leads`). */
      type: "request.created";
      leadId: string;
      conversationId: string;
      /** "callback", "quote", "booking", "question", "complaint" or "other". */
      kind: string;
      name: string;
      email: string | null;
      phone: string | null;
      /** When or how the visitor prefers to be reached, in their words. */
      bestTime: string | null;
      /** What the visitor wants, summarised by the assistant. */
      message: string;
      language: string | null;
      at: Date;
    };
export type AddonEventType = AddonEvent["type"];

/** Work an add-on asks the platform to do. Run by the worker, with retries. */
export type AddonEffect = { kind: "email"; to: string[]; subject: string; text: string };

/** A button on the chat page (e.g. "Shop online"). */
export interface ChatLink {
  /** Stable id, unique per assistant. */
  id: string;
  url: string;
  /** Owner's own label; null = the chat page's translated default for `icon`. */
  label: string | null;
  icon: "shop" | "link";
}

export interface AddonDefinition<C = unknown> {
  /** Stable id, stored with each installation. Never change it once released. */
  id: string;
  /** Bumped when the config shape changes; stored with each installation (see `migrate`). */
  version: number;
  category: AddonCategory;
  status: AddonStatus;
  /** Emoji shown on the market card. */
  icon: string;
  name: Localized;
  /** One line for the market card. */
  summary: Localized;
  /** A short paragraph for the details view. */
  description: Localized;
  capabilities: AddonCapability[];
  fields: AddonField[];
  /** Validates the owner's settings (unknown keys are dropped). */
  schema: z.ZodType<C>;
  /** Settings a new installation starts with. */
  defaults: C;
  /** Upgrades settings saved by an older version before they are validated. */
  migrate?(config: unknown, fromVersion: number): unknown;
  /** Text added to the assistant's instructions, or null. */
  prompt?(config: C, ctx: AddonContext): string | null;
  /** Buttons for the chat page. */
  chatLinks?(config: C, ctx: AddonContext): ChatLink[];
  /** Effects for one chat event (no I/O here). */
  onEvent?(event: AddonEvent, config: C, ctx: AddonContext): AddonEffect[];
}

/** Any add-on, whatever its settings type (what the registry stores). */
// biome-ignore lint/suspicious/noExplicitAny: the registry holds add-ons with different settings types
export type AnyAddon = AddonDefinition<any>;

/** Typed helper so each add-on's hooks see its own settings type. */
export const defineAddon = <C>(definition: AddonDefinition<C>): AddonDefinition<C> => definition;
