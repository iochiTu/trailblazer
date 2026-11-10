/** Minimal client for the API, reached through the /api rewrite (same origin, cookie session). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Field problems from validation errors. */
    public issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "error", data.message ?? res.statusText, data.issues ?? []);
  }
  return data as T;
}

export interface Me {
  /** platformRole is set only for Traiblazer staff accounts (never for business users). */
  user: { id: string; email: string; name: string; uiLanguage: string; platformRole: "super_admin" | null };
  tenants: { id: string; name: string; slug: string; plan: string; role: string }[];
}

/** A playbook the assistant follows when a visitor's request matches `when`. */
export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  when: string;
  steps: string[];
  finish: string;
  /** Template workflow it was copied from, if any. */
  template?: string;
}

export interface Bot {
  id: string;
  name: string;
  pack: string;
  variant: string | null;
  status: "draft" | "active" | "paused";
  languages: string[];
  defaultLanguage: string;
  hostedPageEnabled: boolean;
  /** The business's own copy; null = still following the industry template (older assistants). */
  guidelines: string | null;
  workflows: Workflow[] | null;
  settings: {
    theme?: string;
    color?: string;
    assistantName?: string;
    avatar?: { kind: "initials" } | { kind: "icon"; icon: string } | { kind: "image"; assetId: string };
    greeting?: Record<string, string>;
    /** Per language: owner's questions; an empty list hides suggestions; missing = industry defaults. */
    quickReplies?: Record<string, string[]>;
    launcherLabel?: string;
    launcherPosition?: "right" | "left";
    /** Answer visitors in languages that aren't turned on (default true). */
    answerOtherLanguages?: boolean;
    /** Let the assistant take visitors' requests and contact details (default true). */
    followUps?: boolean;
  };
}

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** Opening periods per day ("HH:MM", 24-hour). A day with none is closed. */
export type WeeklyHours = Partial<Record<DayKey, { open: string; close: string }[]>>;

/** What the assistant knows about reaching and visiting the business. */
export interface BusinessProfile {
  businessName: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  address: Record<string, string> | null;
  timezone: string;
  hours: WeeklyHours | null;
  bookingUrl: string | null;
  orderingUrl: string | null;
}

/** What the setup assistant proposes after reading the business's information. */
export interface SetupSuggestion {
  /** Details found in the information; one that wasn't found is left out. */
  profile: {
    businessName?: string;
    phone?: string;
    email?: string;
    websiteUrl?: string;
    address?: string;
    hours?: WeeklyHours;
  };
  /** The business's own words the hours and address were read from. */
  evidence: { hours?: string; address?: string };
  greeting: Record<string, string>;
  quickReplies: Record<string, string[]>;
  /** Questions customers often ask that the information doesn't answer. */
  missing: string[];
  pagesRead: number;
  pagesTotal: number;
  /** No AI model was available: only contact details were looked up. */
  basic?: boolean;
}

export interface SetupRun {
  id: string;
  status: "pending" | "running" | "ready" | "failed" | "applied";
  /** Set while the run is ready for review. */
  suggestion: SetupSuggestion | null;
  /** Why it failed: no_information, unreadable_reply, model_unavailable or timed_out. */
  error: string | null;
  updatedAt: string;
}

export interface BotDetail {
  bot: Bot;
  keys: { id: string; publicKey: string; allowedOrigins: string[] }[];
  profile: BusinessProfile | null;
  pack: Pack | null;
  /** What the assistant uses now: its own guidelines and workflows, or its template's. */
  behavior: { guidelines: string; workflows: Workflow[] };
  /** The industry template the assistant started from. */
  defaults: {
    quickReplies: Record<string, string[]>;
    guidelines: string;
    /** Starter workflows a new assistant gets. */
    workflows: Workflow[];
    /** Every workflow template the business can add: for its industry, then for any business. */
    library: (Workflow & { group: "industry" | "common" })[];
  };
  chatUrl: string;
}

/** Text in the portal's languages (add-on market). */
export interface Localized {
  en: string;
  fr: string;
}

/** A setting an add-on asks for; the settings form is built from these. */
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

export type AddonCategory = "notifications" | "commerce" | "booking" | "marketing" | "productivity";
export type AddonCapability = "prompt" | "chat_links" | "notifications";

/** An add-on in the market (from @traiblazer/addons). */
export interface AddonCatalogEntry {
  id: string;
  version: number;
  category: AddonCategory;
  status: "available" | "coming_soon";
  icon: string;
  name: Localized;
  summary: Localized;
  description: Localized;
  capabilities: AddonCapability[];
  fields: AddonField[];
  defaults: Record<string, unknown>;
}

/** An add-on installed on an assistant. */
export interface InstalledAddon {
  addonId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** "invalid": settings need attention; "unknown": the add-on left the market. */
  status: "ok" | "invalid" | "unknown";
  updatedAt: string;
}

export interface Source {
  id: string;
  type: "website" | "text";
  title: string;
  url: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  documentCount: number;
  lastSyncedAt: string | null;
}

export interface QaPair {
  id: string;
  question: string;
  answer: string;
  language: string;
}

/** A question visitors asked that the assistant couldn't answer from the business's information. */
export interface KnowledgeGap {
  id: string;
  /** What was missing, in a few words. */
  topic: string;
  /** The latest visitor question about it. */
  question: string;
  language: string | null;
  status: "open" | "answered" | "dismissed";
  occurrences: number;
  lastAskedAt: string;
}

export type LeadStatus = "new" | "in_progress" | "done";

/** A request a visitor left with the assistant for the business to follow up on. */
export interface Lead {
  id: string;
  conversationId: string | null;
  /** "playground" = left while testing the assistant. */
  channel: string;
  kind: "callback" | "quote" | "booking" | "question" | "complaint" | "other";
  status: LeadStatus;
  name: string;
  email: string | null;
  phone: string | null;
  bestTime: string | null;
  message: string;
  language: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  channel: string;
  language: string | null;
  messageCount: number;
  lastMessageAt: string;
}

/** An image a visitor sent; the data is fetched separately (see ConversationsTab). */
export interface MessageAttachment {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

/** A business photo in the knowledge base (public; the assistant can show it to visitors). */
export interface KnowledgePhoto {
  id: string;
  assetId: string;
  title: string;
  description: string;
  enabled: boolean;
  url: string;
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: MessageAttachment[];
  /** Business photos the assistant showed with this reply. */
  images?: { id: string; title: string; url: string }[];
  createdAt: string;
  model: string | null;
  costMicros: number | null;
}

export interface Pack {
  slug: string;
  name: string;
  variants: { slug: string; name: string }[];
}

export interface Language {
  code: string;
  englishName: string;
  nativeName: string;
  tier: 1 | 2 | 3 | "owner";
  dir: "ltr" | "rtl";
}

/** A subscription plan as shown on the public portal page. Price is monthly, in CAD cents. */
export interface PublicPlan {
  id: string;
  nameEn: string;
  nameFr: string;
  monthlyQuestions: number;
  perMinute: number;
  concurrent: number;
  knowledgeImages: number;
  priceMonthlyCents: number | null;
}
