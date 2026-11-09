import { z } from "zod";

/**
 * Plan allowances (PLAN.md §16). Monthly questions cap AI cost per business; the per-minute and
 * concurrency limits keep one busy business from slowing down everyone else ("noisy neighbours").
 */
export interface PlanLimits {
  name: Record<"en" | "fr", string>;
  /** Visitor questions answered per calendar month. */
  monthlyQuestions: number;
  /** Answers being generated at the same time for this business. */
  concurrent: number;
  /** Questions per minute for this business (all visitors together). */
  perMinute: number;
  /** Photos each assistant can keep in its knowledge base. */
  knowledgeImages: number;
}

export const PLANS = {
  trial: {
    name: { en: "Free trial", fr: "Essai gratuit" },
    monthlyQuestions: 100,
    concurrent: 3,
    perMinute: 20,
    knowledgeImages: 20,
  },
  local: {
    name: { en: "Local", fr: "Local" },
    monthlyQuestions: 1000,
    concurrent: 5,
    perMinute: 40,
    knowledgeImages: 50,
  },
  local_plus: {
    name: { en: "Local Plus", fr: "Local Plus" },
    monthlyQuestions: 3000,
    concurrent: 8,
    perMinute: 60,
    knowledgeImages: 100,
  },
  professional: {
    name: { en: "Professional", fr: "Professionnel" },
    monthlyQuestions: 5000,
    concurrent: 10,
    perMinute: 90,
    knowledgeImages: 200,
  },
  business: {
    name: { en: "Business", fr: "Affaires" },
    monthlyQuestions: 20000,
    concurrent: 25,
    perMinute: 200,
    knowledgeImages: 500,
  },
} as const satisfies Record<string, PlanLimits>;

export type PlanId = keyof typeof PLANS;

export function planLimits(plan: string): PlanLimits {
  return (PLANS as Record<string, PlanLimits>)[plan] ?? PLANS.trial;
}

/** Default questions one visitor may ask per day (all assistants of the business). */
export const DEFAULT_VISITOR_DAILY_LIMIT = 30;
/** Questions per conversation before the visitor is asked to start a new one. */
export const MAX_CONVERSATION_QUESTIONS = 40;
/** Monthly periods and daily usage are counted in this time zone. */
export const REPORTING_TIME_ZONE = "America/Toronto";

/** The monthly limit in force: the owner's own cap, never above the plan's allowance. */
export function effectiveMonthlyLimit(
  planMonthlyQuestions: number,
  ownerLimit: number | null | undefined,
): number {
  return ownerLimit ? Math.min(ownerLimit, planMonthlyQuestions) : planMonthlyQuestions;
}

// ---- Operator console: plans and platform policies -------------------------------------------
// Plans and policies live in the database (operators edit them); the constants above are the
// seed values and the fallback if the database has no row.

/** Platform-wide policies set by operators. */
export interface PlatformPolicies {
  /** Plan given to newly created businesses. */
  defaultPlan: string;
  /** Default questions per visitor per day (businesses can set their own). */
  visitorDailyLimit: number;
  /** Questions per conversation before the visitor is asked to start a new one. */
  conversationMaxQuestions: number;
  /** Chat messages per IP address per minute (flood protection). */
  chatIpPerMinute: number;
  /** Highest industry-pack rollout phase businesses can choose (1 = launch packs). */
  releasedPackPhase: number;
  /**
   * Businesses one account can own. Each new business starts with the default plan's free
   * allowance, so this stops one account from collecting unlimited free quota.
   */
  maxBusinessesPerAccount: number;
}

export const DEFAULT_POLICIES: PlatformPolicies = {
  defaultPlan: "trial",
  visitorDailyLimit: DEFAULT_VISITOR_DAILY_LIMIT,
  conversationMaxQuestions: MAX_CONVERSATION_QUESTIONS,
  chatIpPerMinute: 20,
  releasedPackPhase: 1,
  maxBusinessesPerAccount: 3,
};

/** Database keys (snake_case) for each policy. */
export const POLICY_KEYS: Record<keyof PlatformPolicies, string> = {
  defaultPlan: "default_plan",
  visitorDailyLimit: "visitor_daily_limit",
  conversationMaxQuestions: "conversation_max_questions",
  chatIpPerMinute: "chat_ip_per_minute",
  releasedPackPhase: "released_pack_phase",
  maxBusinessesPerAccount: "max_businesses_per_account",
};

export const updatePoliciesSchema = z
  .object({
    defaultPlan: z.string().regex(/^[a-z0-9_]{2,40}$/),
    visitorDailyLimit: z.number().int().min(1).max(1000),
    conversationMaxQuestions: z.number().int().min(2).max(500),
    chatIpPerMinute: z.number().int().min(1).max(600),
    releasedPackPhase: z.number().int().min(1).max(4),
    maxBusinessesPerAccount: z.number().int().min(1).max(100),
  })
  .partial();

const planFields = {
  nameEn: z.string().trim().min(1).max(60),
  nameFr: z.string().trim().min(1).max(60),
  monthlyQuestions: z.number().int().min(1).max(10_000_000),
  concurrent: z.number().int().min(1).max(1000),
  perMinute: z.number().int().min(1).max(100_000),
  knowledgeImages: z.number().int().min(0).max(10_000),
  priceMonthlyCents: z.number().int().min(0).max(100_000_000).nullable(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
};

export const createPlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{2,40}$/, "Use lowercase letters, digits and _"),
  ...planFields,
  priceMonthlyCents: planFields.priceMonthlyCents.optional(),
  active: planFields.active.optional(),
  sortOrder: planFields.sortOrder.optional(),
  knowledgeImages: planFields.knowledgeImages.optional(),
});
export const updatePlanSchema = z.object(planFields).partial();

export const operatorTenantUpdateSchema = z
  .object({ plan: z.string().regex(/^[a-z0-9_]{2,40}$/), status: z.enum(["active", "suspended"]) })
  .partial();

export const updateLimitsSchema = z
  .object({
    /** Null = use the plan's allowance. */
    monthlyQuestionLimit: z.number().int().min(1).max(1_000_000).nullable(),
    /** Null = default per-visitor limit. */
    visitorDailyLimit: z.number().int().min(1).max(500).nullable(),
  })
  .partial();
export type UpdateLimitsInput = z.infer<typeof updateLimitsSchema>;
