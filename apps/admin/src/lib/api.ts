/** Minimal client for the API, reached through the /api rewrite (same origin, cookie session). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? res.statusText);
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
  };
}

export interface BotDetail {
  bot: Bot;
  keys: { id: string; publicKey: string; allowedOrigins: string[] }[];
  profile: { businessName: string | null } | null;
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
