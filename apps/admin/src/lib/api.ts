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
  /** Friendly link to the business page (<chat-domain>/<slug>), if set. */
  pageSlug: string | null;
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
    /** Business page layout and search-engine listing (listed by default). */
    page?: { preset?: "business" | "personal"; listed?: boolean };
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
  /** Business page: a line or two under the name, area served, licences and insurance. */
  description: string | null;
  serviceArea: string | null;
  credentials: string | null;
  /** Service area as lists, for the assistant's service-area check. */
  serviceTowns: string[];
  servicePostalPrefixes: string[];
}

/** A service or product card on the business page. */
export interface CatalogItem {
  id: string;
  kind: "service" | "product";
  name: string;
  description: string | null;
  priceText: string | null;
  category: string | null;
  action: "ask" | "quote" | "book";
  enabled: boolean;
  position: number;
  photoUrl: string | null;
}

/** Contact buttons on the business page whose taps are counted. */
export type PageAction = "call" | "book" | "email" | "directions" | "website" | "link";

/** How the business page is doing over the last `days` days (counts only). */
export interface PageStats {
  days: number;
  totals: {
    views: number;
    taps: Record<PageAction, number>;
    /** Questions visitors asked the assistant (page and website chat; tests left out). */
    questions: number;
    conversations: number;
    requests: number;
    urgentRequests: number;
  };
  daily: { date: string; views: number; taps: number; questions: number; requests: number }[];
}

/** A time-limited announcement on the page and in answers. */
export interface Notice {
  id: string;
  text: string;
  startsAt: string | null;
  endsAt: string | null;
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
    /** One or two sentences for the top of the business page. */
    description?: string;
  };
  /** Services and products found for the business page (absent on older suggestions). */
  services?: {
    kind: "service" | "product";
    name: string;
    description?: string;
    /** In the business's own words; left out when its information gives no price. */
    priceText?: string;
    category?: string;
  }[];
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
    /** Details the industry asks for on requests (vehicle, tire size, address…). */
    leadFields: { key: string; label: Localized; hint: string }[];
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

export type AddonCategory = "notifications" | "commerce" | "booking" | "marketing" | "productivity" | "crm";
export type AddonCapability = "prompt" | "chat_links" | "notifications" | "crm";

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
  /** Id of the outside account (CRM) this add-on needs connected, if any. */
  integration: string | null;
  defaults: Record<string, unknown>;
}

/** A CRM the assistant can connect to, and this assistant's connection to it (never its credentials). */
export interface Integration {
  id: string;
  name: string;
  /** "fields": the owner pastes keys. "oauth2": the owner signs in at the CRM. */
  auth: "fields" | "oauth2";
  fields: {
    key: string;
    label: Localized;
    hint?: Localized;
    secret: boolean;
    required: boolean;
    placeholder?: string;
    maxLength?: number;
  }[];
  /** False when the platform can't connect it yet (its own keys for this CRM are missing). */
  available: boolean;
  connection: {
    /** "error": the CRM refused the saved credentials; connect again. */
    status: "connected" | "error";
    accountName: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    lastSuccessAt: string | null;
    connectedAt: string;
  } | null;
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
  /** file: an uploaded price list or brochure, read into text. */
  type: "website" | "text" | "file";
  title: string;
  url: string | null;
  /** Uploaded files: the file's name. */
  fileName: string | null;
  /** The setup interview's answers (a text source edited through the interview). */
  interview?: boolean;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  documentCount: number;
  lastSyncedAt: string | null;
}

/** A question of the setup interview, in English and French. */
export interface InterviewQuestion {
  key: string;
  question: { en: string; fr: string };
  hint: { en: string; fr: string };
  long?: boolean;
}

export interface Interview {
  questions: InterviewQuestion[];
  answers: Record<string, string>;
  sourceId: string | null;
  updatedAt: string | null;
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
  /** A problem that can't wait; the business was emailed at once. */
  urgent: boolean;
  /** Industry details (e.g. vehicle, tire size), keyed by the template's lead fields. */
  details: Record<string, string>;
  /** The service or product the request is about, when it started from one. */
  itemName: string | null;
  /** Photos the visitor sent in the conversation. */
  attachmentIds: string[];
  /** Where the request stands with each connected CRM. */
  syncs: {
    provider: string;
    providerName: string;
    status: "sent" | "failed";
    /** Where to open it in the CRM, when the CRM gives a link. */
    externalUrl: string | null;
    error: string | null;
    updatedAt: string;
  }[];
  createdAt: string;
}

/** An assistant's phone number and what it does (Phone tab). */
export interface PhoneNumber {
  id: string;
  e164: string;
  /** The number as people write it, e.g. "+1 807 555 0142". */
  display: string;
  provider: string;
  smsEnabled: boolean;
  /** What a call does: "text_back" = one sentence, then a text; "off" = calls are refused. */
  callMode: "text_back" | "off";
}

export interface PhoneSettings {
  phone: PhoneNumber | null;
  /** Phone and SMS are set up on this platform. */
  available: boolean;
  stats: { textsSent30Days: number; optOuts: number };
  /** True for Traiblazer staff in support mode: only they assign or remove a number. */
  canAssign: boolean;
  /** Addresses to enter at the telephony provider (staff only). */
  webhooks: { sms: string; voice: string } | null;
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
