/** Types and helpers for the operator console (Traiblazer staff only, English-only UI). */

export interface OperatorOverview {
  period: string;
  businesses: number;
  suspended: number;
  assistants: number;
  activeAssistants: number;
  questions: number;
  refused: number;
  costMicros: number;
  byPlan: Record<string, number>;
  /** Prospect demos, counted apart from businesses, and what they cost this month. */
  demos: number;
  demoCostMicros: number;
}

/** A prospect demo page built by operators (see the Demos tab). */
export interface OperatorDemo {
  id: string;
  tenantId: string;
  botId: string;
  name: string;
  /** Plan the customer tries. */
  plan: string;
  /** Set while the customer can sign in with an access code (the code is only shown when made). */
  access: { createdAt: string; lastUsedAt: string | null } | null;
  industry: string | null;
  status: "building" | "ready" | "needs_information" | "failed" | "handed_over";
  error: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  handedOverTo: string | null;
  handedOverAt: string | null;
  pageUrl: string | null;
  sources: { type: string; status: string; url: string | null }[];
  services: number;
  /** Times the demo page was opened, chats on it and requests left (test chats not counted). */
  views: number;
  conversations: number;
  requests: number;
}

export interface OperatorTenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: "active" | "suspended";
  /** The agency (reseller) that manages it, if any. */
  agency: { id: string; name: string } | null;
  billingMode: "client_pays" | "agency_pays" | null;
  owners: string[];
  createdAt: string;
  assistants: number;
  activeAssistants: number;
  questions: number;
  monthlyLimit: number;
  refused: number;
  costMicros: number;
}

export interface OperatorPlan {
  id: string;
  nameEn: string;
  nameFr: string;
  monthlyQuestions: number;
  concurrent: number;
  perMinute: number;
  knowledgeImages: number;
  insights: boolean;
  priceMonthlyCents: number | null;
  setupFeeCents: number | null;
  active: boolean;
  sortOrder: number;
  businesses: number;
}

export interface Policies {
  defaultPlan: string;
  visitorDailyLimit: number;
  conversationMaxQuestions: number;
  chatIpPerMinute: number;
  releasedPackPhase: number;
  maxBusinessesPerAccount: number;
  agencySharePercent: number;
}

export interface OperatorAgency {
  id: string;
  name: string;
  status: "applied" | "active" | "suspended" | "declined";
  website: string | null;
  country: string | null;
  currency: string;
  applicationNote: string | null;
  sharePercent: number | null;
  billingModes: ("client_pays" | "agency_pays")[];
  trialClientCap: number;
  payoutsHeld: boolean;
  owners: string[];
  clients: number;
  createdAt: string;
  approvedAt: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: string | null;
}

const numberFmt = new Intl.NumberFormat("en-CA");
export const fmtNumber = (n: number) => numberFmt.format(n);
export const fmtUsd = (micros: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "USD" }).format(micros / 1_000_000);
export const fmtCad = (cents: number | null) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 }).format(
        cents / 100,
      );

/** What each industry-pack rollout phase adds (cumulative). */
export const PACK_PHASES: Record<number, string> = {
  1: "Phase 1 — launch: trades, auto repair & tire shops, restaurants, cafés, retail, salons, lodging, attractions, other",
  2: "Phase 2 — adds property management, business services, grocery, breweries, arts, gyms, tutoring, non-profits",
  3: "Phase 3 — adds clinics, pharmacies, law, accounting, insurance, immigration, real estate, dealerships",
  4: "Phase 4 — adds mining, engineering, manufacturing, auto makers, logistics, utilities, colleges",
};

export type OnboardingStepId = "sources" | "page" | "services" | "photos" | "review" | "google" | "live";

/** A done-for-you onboarding checklist (see the Onboarding tab). */
export interface OperatorOnboarding {
  id: string;
  tenantId: string;
  botId: string;
  business: string;
  businessStatus: "active" | "suspended";
  assistant: string;
  pageUrl: string | null;
  receivedAt: string;
  dueAt: string;
  liveAt: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  facts: {
    sources: { ready: number; failed: number; pending: number };
    missing: ("description" | "contact" | "hours")[];
    services: number;
    photos: number;
    live: boolean;
  };
  steps: {
    id: OnboardingStepId;
    /** Ticked by staff (true) or checked from the business's data (false). */
    manual: boolean;
    state: "done" | "skipped" | "open";
    mark: { state: "done" | "skipped"; at: string; by: string | null } | null;
  }[];
  /** Every step done or not needed. */
  finished: boolean;
}

type Localized = { en: string; fr: string };

/** A question of the setup interview's set (Onboarding questions tab). */
export interface OperatorQuestion {
  id: string;
  /** Stable: businesses' answers are stored under it. */
  key: string;
  /** Industry slugs it is asked for; empty: every industry. */
  packs: string[];
  kind: "short" | "long" | "choice";
  question: Localized;
  hint: Localized;
  options: Localized[];
  sortOrder: number;
  enabled: boolean;
  /** One of the standard questions (it can be reset to the standard wording). */
  standard: boolean;
  /** Changed from the standard wording. */
  modified: boolean;
  updatedAt: string;
}

export interface OperatorQuestionPack {
  slug: string;
  name: string;
  phase: number;
}
