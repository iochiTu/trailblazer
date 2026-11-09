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
}

export interface OperatorTenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: "active" | "suspended";
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
  priceMonthlyCents: number | null;
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
  1: "Phase 1 — launch: restaurants, cafés, retail, salons, lodging, attractions, other",
  2: "Phase 2 — adds grocery, breweries, arts, gyms, business services, trades, auto repair, tutoring, non-profits",
  3: "Phase 3 — adds clinics, pharmacies, law, accounting, insurance, immigration, real estate, dealerships",
  4: "Phase 4 — adds mining, engineering, manufacturing, auto makers, logistics, utilities, colleges",
};
