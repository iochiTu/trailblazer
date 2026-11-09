import { conversations, type Db, messages, tenants, usageCounters, withTenant } from "@traiblazer/db";
import { effectiveMonthlyLimit, REPORTING_TIME_ZONE } from "@traiblazer/shared";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Limiter } from "./limiter.js";
import type { PlatformConfig } from "./platform.js";

export type RefusalReason = "quota" | "busy" | "visitor" | "conversation";

export type Admission = { ok: true; release: () => Promise<void> } | { ok: false; reason: RefusalReason };

/** "YYYY-MM" of the given moment in the reporting time zone (quota periods). */
export function periodKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

const BLOCK_COLUMN = {
  quota: "blocked_quota",
  busy: "blocked_busy",
  visitor: "blocked_visitor",
  conversation: "blocked_visitor",
} as const;

/** Counts a refused question for the usage page. */
async function recordRefusal(db: Db, tenantId: string, reason: RefusalReason): Promise<void> {
  const column = sql.identifier(BLOCK_COLUMN[reason]);
  await withTenant(db, tenantId, (tx) =>
    tx.execute(sql`
      insert into usage_counters (tenant_id, period, ${column}) values (${tenantId}, ${periodKey()}, 1)
      on conflict (tenant_id, period) do update set ${column} = usage_counters.${column} + 1, updated_at = now()`),
  );
}

/**
 * Decides whether a visitor's question may be answered. Checks, cheapest first:
 *  1. abuse: questions per visitor per day, questions per conversation
 *  2. noisy neighbours: this business's questions per minute and answers in progress
 *  3. the monthly question limit (counted atomically, so parallel requests can't overshoot)
 * On success the caller must call `release()` when the answer is finished.
 */
export async function admitQuestion(
  deps: {
    db: Db;
    limiter: Limiter;
    platform: PlatformConfig;
    /** Override of the operator policy (tests). */
    maxConversationQuestions?: number;
  },
  input: { tenantId: string; visitorId: string; conversationId: string | null },
): Promise<Admission> {
  const { db, limiter } = deps;
  const [tenant] = await db
    .select({
      plan: tenants.plan,
      monthlyQuestionLimit: tenants.monthlyQuestionLimit,
      visitorDailyLimit: tenants.visitorDailyLimit,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant) return { ok: false, reason: "busy" };
  // Plan allowances and platform policies come from the operator console.
  const [plan, policies] = await Promise.all([deps.platform.plan(tenant.plan), deps.platform.policies()]);
  const maxConversationQuestions = deps.maxConversationQuestions ?? policies.conversationMaxQuestions;

  const refuse = async (reason: RefusalReason): Promise<Admission> => {
    await recordRefusal(db, input.tenantId, reason);
    return { ok: false, reason };
  };

  // 1. Abuse protection.
  const abuse = await withTenant(db, input.tenantId, async (tx) => {
    const [today] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(conversations.visitorId, input.visitorId),
          eq(messages.role, "user"),
          gt(messages.createdAt, sql`now() - interval '24 hours'`),
        ),
      );
    if ((today?.count ?? 0) >= (tenant.visitorDailyLimit ?? policies.visitorDailyLimit))
      return "visitor" as const;

    if (input.conversationId) {
      const [conversation] = await tx
        .select({ messageCount: conversations.messageCount })
        .from(conversations)
        .where(and(eq(conversations.id, input.conversationId), eq(conversations.visitorId, input.visitorId)))
        .limit(1);
      if (conversation && Math.ceil(conversation.messageCount / 2) >= maxConversationQuestions) {
        return "conversation" as const;
      }
    }
    return null;
  });
  if (abuse) return refuse(abuse);

  // 2. Noisy neighbours: one busy business must not use up capacity shared with everyone else.
  if (!(await limiter.hit(`tenant-rate:${input.tenantId}`, plan.perMinute, 60))) return refuse("busy");
  const release = await limiter.acquire(`tenant-slots:${input.tenantId}`, plan.concurrent, 120);
  if (!release) return refuse("busy");

  // 3. Monthly limit: increment only while below the limit (atomic, no overshoot under load).
  const limit = effectiveMonthlyLimit(plan.monthlyQuestions, tenant.monthlyQuestionLimit);
  const counted = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{ questions: number }>(sql`
      insert into usage_counters (tenant_id, period, questions) values (${input.tenantId}, ${periodKey()}, 1)
      on conflict (tenant_id, period) do update
        set questions = usage_counters.questions + 1, updated_at = now()
        where usage_counters.questions < ${limit}
      returning questions`),
  );
  if (!counted.length) {
    await release();
    return refuse("quota");
  }
  return { ok: true, release };
}

/** Image uploads allowed per hour: per visitor (abuse) and per business (storage and AI cost). */
export const IMAGE_LIMITS = { visitorPerHour: 20, tenantPerHour: 500 } as const;

/**
 * Counts a visitor's images against the hourly upload limits. Checked before the question itself,
 * so a refused upload never uses up the monthly question allowance.
 */
export async function admitImages(
  limiter: Limiter,
  input: { tenantId: string; visitorId: string; count: number },
  limits: { visitorPerHour: number; tenantPerHour: number } = IMAGE_LIMITS,
): Promise<boolean> {
  for (let i = 0; i < input.count; i++) {
    if (
      !(await limiter.hit(`images-visitor:${input.tenantId}:${input.visitorId}`, limits.visitorPerHour, 3600))
    )
      return false;
    if (!(await limiter.hit(`images-tenant:${input.tenantId}`, limits.tenantPerHour, 3600))) return false;
  }
  return true;
}

/** Current month's counters for a business (zeros when nothing was asked yet). */
export async function currentUsage(db: Db, tenantId: string) {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(usageCounters)
      .where(and(eq(usageCounters.tenantId, tenantId), eq(usageCounters.period, periodKey())))
      .limit(1),
  );
  return {
    period: periodKey(),
    questions: row?.questions ?? 0,
    blockedQuota: row?.blockedQuota ?? 0,
    blockedBusy: row?.blockedBusy ?? 0,
    blockedVisitor: row?.blockedVisitor ?? 0,
  };
}
