import { type Db, plans, platformSettings } from "@traiblazer/db";
import {
  DEFAULT_POLICIES,
  PLANS,
  type PlanLimits,
  type PlatformPolicies,
  POLICY_KEYS,
} from "@traiblazer/shared";
import { asc } from "drizzle-orm";

export type PlanRow = typeof plans.$inferSelect;

/**
 * Plans and platform policies set in the operator console, cached briefly per API server.
 * Changes made through this server apply immediately (invalidate); other servers pick them up
 * within the cache time.
 */
export class PlatformConfig {
  private cache: { at: number; plans: PlanRow[]; policies: PlatformPolicies } | null = null;

  constructor(
    private readonly db: Db,
    private readonly ttlMs = 30_000,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache;
    const [planRows, settingRows] = await Promise.all([
      this.db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.id)),
      this.db.select().from(platformSettings),
    ]);
    const byKey = new Map(settingRows.map((r) => [r.key, r.value]));
    const policies = { ...DEFAULT_POLICIES };
    for (const [field, key] of Object.entries(POLICY_KEYS) as [keyof PlatformPolicies, string][]) {
      const value = byKey.get(key);
      if (value !== undefined && typeof value === typeof DEFAULT_POLICIES[field]) {
        (policies as Record<string, unknown>)[field] = value;
      }
    }
    this.cache = { at: Date.now(), plans: planRows, policies };
    return this.cache;
  }

  async plans(): Promise<PlanRow[]> {
    return (await this.load()).plans;
  }

  async policies(): Promise<PlatformPolicies> {
    return (await this.load()).policies;
  }

  /** Allowances for a plan id; falls back to the built-in trial values if the plan is missing. */
  async plan(id: string): Promise<PlanLimits & { id: string }> {
    const row = (await this.plans()).find((p) => p.id === id);
    if (row) {
      return {
        id: row.id,
        name: { en: row.nameEn, fr: row.nameFr },
        monthlyQuestions: row.monthlyQuestions,
        concurrent: row.concurrent,
        perMinute: row.perMinute,
        knowledgeImages: row.knowledgeImages,
      };
    }
    return { id: "trial", ...PLANS.trial };
  }
}
