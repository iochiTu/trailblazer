import { planFeatures } from "@traiblazer/core";
import {
  type AgencyRole,
  agencies,
  agencyAuditLogs,
  agencyMembers,
  type Db,
  type MemberRole,
  memberships,
  plans,
  type Tx,
  tenants,
} from "@traiblazer/db";
import { and, eq } from "drizzle-orm";

/**
 * Agencies (resellers, docs/AGENCY.md). An agency's users reach its clients through the agency,
 * never through memberships, and only while the agency is active.
 */

const roleRank: Record<AgencyRole, number> = { member: 0, admin: 1, owner: 2 };

export function hasAgencyRole(actual: AgencyRole, required: AgencyRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

/** The user's way into a business through its agency, or null. */
export async function agencyAccess(
  db: Db,
  userId: string,
  tenantId: string,
): Promise<{ agencyId: string; role: AgencyRole } | null> {
  const [row] = await db
    .select({ agencyId: agencies.id, role: agencyMembers.role })
    .from(tenants)
    .innerJoin(agencies, eq(agencies.id, tenants.agencyId))
    .innerJoin(agencyMembers, eq(agencyMembers.agencyId, agencies.id))
    .where(and(eq(tenants.id, tenantId), eq(agencyMembers.userId, userId), eq(agencies.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function logAgency(
  db: Db | Tx,
  entry: {
    agencyId: string;
    actorUserId: string | null;
    action: string;
    tenantId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(agencyAuditLogs).values({
    agencyId: entry.agencyId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    tenantId: entry.tenantId ?? null,
    metadata: entry.metadata ?? {},
  });
}

/** What a client's users see of its agency (its brand in place of ours, docs/AGENCY.md §5). */
export interface TenantAgency {
  id: string;
  name: string;
  logoUrl: string | null;
  color: string | null;
  supportEmail: string | null;
  website: string | null;
}

const toTenantAgency = (agency: typeof agencies.$inferSelect | null): TenantAgency | null =>
  agency
    ? {
        id: agency.id,
        name: agency.name,
        logoUrl: agency.branding.logoUrl ?? null,
        color: agency.branding.color ?? null,
        supportEmail: agency.branding.supportEmail ?? null,
        website: agency.branding.website ?? null,
      }
    : null;

/**
 * The businesses a user can open: the ones they are a member of, then the clients of the active
 * agencies they work for (as AGENCY_ROLE, `via: "agency"`). Each carries its agency, if it has one.
 */
export async function userTenants(db: Db, userId: string) {
  const own = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.plan,
      role: memberships.role,
      insights: plans.insights,
      agency: agencies,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(plans, eq(plans.id, tenants.plan))
    .leftJoin(agencies, eq(agencies.id, tenants.agencyId))
    .where(eq(memberships.userId, userId))
    .orderBy(tenants.name);
  const viaAgency = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.plan,
      insights: plans.insights,
      agency: agencies,
    })
    .from(agencyMembers)
    .innerJoin(agencies, eq(agencies.id, agencyMembers.agencyId))
    .innerJoin(tenants, eq(tenants.agencyId, agencies.id))
    .leftJoin(plans, eq(plans.id, tenants.plan))
    .where(and(eq(agencyMembers.userId, userId), eq(agencies.status, "active")))
    .orderBy(tenants.name);
  const ownIds = new Set(own.map((t) => t.id));
  return [
    ...own.map(({ insights, agency, ...t }) => ({
      ...t,
      features: planFeatures({ insights: insights ?? false }),
      via: "member" as const,
      agency: toTenantAgency(agency),
    })),
    ...viaAgency
      .filter((t) => !ownIds.has(t.id))
      .map(({ insights, agency, ...t }) => ({
        ...t,
        role: "admin" as MemberRole,
        features: planFeatures({ insights: insights ?? false }),
        via: "agency" as const,
        agency: toTenantAgency(agency),
      })),
  ];
}

/** The agencies a user works for, with their role. */
export async function userAgencies(db: Db, userId: string) {
  const rows = await db
    .select({ id: agencies.id, name: agencies.name, status: agencies.status, role: agencyMembers.role })
    .from(agencyMembers)
    .innerJoin(agencies, eq(agencies.id, agencyMembers.agencyId))
    .where(eq(agencyMembers.userId, userId))
    .orderBy(agencies.name);
  return rows;
}
