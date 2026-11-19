import { periodKey } from "@traiblazer/core";
import {
  type AgencyRole,
  agencies,
  agencyAuditLogs,
  agencyMembers,
  memberships,
  tenants,
  users,
} from "@traiblazer/db";
import {
  agencyApplicationSchema,
  agencyBrandingSchema,
  agencyClientOwnerSchema,
  agencyClientSchema,
  agencyClientUpdateSchema,
  agencyMemberSchema,
  effectiveMonthlyLimit,
  REPORTING_TIME_ZONE,
} from "@traiblazer/shared";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { hasAgencyRole, logAgency } from "../lib/agencies.js";
import { audit } from "../lib/audit.js";
import { conflict, forbidden, HttpError, isUniqueViolation, notFound } from "../lib/errors.js";
import { isUuid, slugify } from "../lib/ids.js";
import { isSuperAdmin, requireUser } from "../plugins/auth.js";

/**
 * The agency panel's API (docs/AGENCY.md §3.2): an agency's clients, team and branding. Only the
 * agency's own users get in; everyone else gets 404, so agency ids can't be probed. Clients are
 * ordinary businesses with `agency_id` set; the agency's users open them through
 * requireTenantRole's agency path.
 */

type AgencyParams = { Params: { agencyId: string } };
type ClientParams = { Params: { agencyId: string; tenantId: string } };
type MemberParams = { Params: { agencyId: string; userId: string } };

/** The plan an agency client starts on. */
const TRIAL_PLAN = "trial";

interface TenantStatsRow extends Record<string, unknown> {
  tenant_id: string;
  bots: number;
  active_bots: number;
  questions: number;
}

export async function agencyRoutes(app: FastifyInstance, { db, platform }: AppContext) {
  /** The signed-in user's agency and role, or 404. `minimum` gates what they may do. */
  async function requireAgency(request: FastifyRequest<AgencyParams>, minimum: AgencyRole = "member") {
    const user = request.user;
    if (!user) throw new HttpError(401, "unauthorized", "Sign in required");
    const { agencyId } = request.params;
    if (!isUuid(agencyId)) throw notFound("Agency");
    const [row] = await db
      .select({ agency: agencies, role: agencyMembers.role })
      .from(agencyMembers)
      .innerJoin(agencies, eq(agencies.id, agencyMembers.agencyId))
      .where(and(eq(agencyMembers.agencyId, agencyId), eq(agencyMembers.userId, user.id)))
      .limit(1);
    if (!row) throw notFound("Agency");
    if (!hasAgencyRole(row.role, minimum)) throw forbidden();
    return row;
  }

  /** Like requireAgency, for changes: the agency must be approved and not suspended. */
  async function requireActiveAgency(request: FastifyRequest<AgencyParams>, minimum: AgencyRole = "member") {
    const row = await requireAgency(request, minimum);
    if (row.agency.status !== "active") {
      throw new HttpError(403, "agency_not_active", "Your agency isn't active yet.");
    }
    return row;
  }

  /** One of the agency's clients, or 404. */
  async function clientOf(agencyId: string, tenantId: string) {
    if (!isUuid(tenantId)) throw notFound("Business");
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), eq(tenants.agencyId, agencyId)))
      .limit(1);
    if (!tenant) throw notFound("Business");
    return tenant;
  }

  const publicAgency = (agency: typeof agencies.$inferSelect, role: AgencyRole) => ({
    id: agency.id,
    name: agency.name,
    slug: agency.slug,
    status: agency.status,
    website: agency.website,
    country: agency.country,
    currency: agency.currency,
    billingModes: agency.billingModes,
    trialClientCap: agency.trialClientCap,
    branding: agency.branding,
    createdAt: agency.createdAt,
    approvedAt: agency.approvedAt,
    role,
  });

  // ---- The user's agencies, and applying ----------------------------------------------------

  app.get("/v1/agencies", { preHandler: requireUser }, async (request) => {
    const rows = await db
      .select({ agency: agencies, role: agencyMembers.role })
      .from(agencyMembers)
      .innerJoin(agencies, eq(agencies.id, agencyMembers.agencyId))
      .where(eq(agencyMembers.userId, request.user!.id))
      .orderBy(agencies.name);
    return { agencies: rows.map((r) => publicAgency(r.agency, r.role)) };
  });

  app.post("/v1/agencies", { preHandler: requireUser }, async (request, reply) => {
    const user = request.user!;
    if (isSuperAdmin(user)) {
      throw new HttpError(
        403,
        "staff_account",
        "Staff accounts can't join an agency. Use a separate account.",
      );
    }
    if (user.demo) {
      throw new HttpError(403, "demo_account", "A demo account can't apply. Sign up to get started.");
    }
    const input = agencyApplicationSchema.parse(request.body);
    const agency = await db.transaction(async (tx) => {
      // One application at a time per account: an applied or active agency it owns blocks another.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agency-owner:${user.id}`}))`);
      const [open] = await tx
        .select({ id: agencies.id })
        .from(agencyMembers)
        .innerJoin(agencies, eq(agencies.id, agencyMembers.agencyId))
        .where(
          and(
            eq(agencyMembers.userId, user.id),
            eq(agencyMembers.role, "owner"),
            sql`${agencies.status} in ('applied', 'active')`,
          ),
        )
        .limit(1);
      if (open) throw conflict("You already have an agency or an application waiting.");
      const [created] = await tx
        .insert(agencies)
        .values({
          name: input.name,
          slug: slugify(input.name),
          website: input.website ?? null,
          country: input.country,
          currency: input.currency,
          applicationNote: input.note ?? null,
        })
        .returning();
      await tx.insert(agencyMembers).values({ agencyId: created!.id, userId: user.id, role: "owner" });
      await logAgency(tx, { agencyId: created!.id, actorUserId: user.id, action: "agency.applied" });
      return created!;
    });
    return reply.code(201).send({ agency: publicAgency(agency, "owner") });
  });

  app.get<AgencyParams>("/v1/agencies/:agencyId", { preHandler: requireUser }, async (request) => {
    const { agency, role } = await requireAgency(request);
    return { agency: publicAgency(agency, role) };
  });

  // ---- Overview -----------------------------------------------------------------------------

  app.get<AgencyParams>("/v1/agencies/:agencyId/overview", { preHandler: requireUser }, async (request) => {
    const { agency } = await requireAgency(request);
    const clients = await db
      .select({
        id: tenants.id,
        plan: tenants.plan,
        status: tenants.status,
        mode: tenants.agencyBillingMode,
      })
      .from(tenants)
      .where(eq(tenants.agencyId, agency.id));
    const stats = await clientStats(clients.map((c) => c.id));
    const byPlan: Record<string, number> = {};
    for (const c of clients) byPlan[c.plan] = (byPlan[c.plan] ?? 0) + 1;
    return {
      period: periodKey(),
      clients: clients.length,
      suspended: clients.filter((c) => c.status === "suspended").length,
      trial: clients.filter((c) => c.plan === TRIAL_PLAN).length,
      clientPays: clients.filter((c) => c.mode === "client_pays").length,
      agencyPays: clients.filter((c) => c.mode === "agency_pays").length,
      byPlan,
      questions: [...stats.values()].reduce((sum, s) => sum + Number(s.questions), 0),
      activeAssistants: [...stats.values()].reduce((sum, s) => sum + Number(s.active_bots), 0),
    };
  });

  /** This month's totals per client (aggregate tables only; never conversation text). */
  async function clientStats(ids: string[]) {
    if (ids.length === 0) return new Map<string, TenantStatsRow>();
    const tz = REPORTING_TIME_ZONE;
    const rows = await db.execute<TenantStatsRow>(
      sql`select tenant_id, bots, active_bots, questions from app_operator_tenant_stats(${periodKey()}, (date_trunc('month', now() at time zone ${tz}) at time zone ${tz}))`,
    );
    const wanted = new Set(ids);
    return new Map(rows.filter((r) => wanted.has(r.tenant_id)).map((r) => [r.tenant_id, r]));
  }

  // ---- Clients ------------------------------------------------------------------------------

  app.get<AgencyParams>("/v1/agencies/:agencyId/clients", { preHandler: requireUser }, async (request) => {
    const { agency } = await requireAgency(request);
    const [rows, owners, planRows] = await Promise.all([
      db.select().from(tenants).where(eq(tenants.agencyId, agency.id)).orderBy(tenants.name),
      db
        .select({ tenantId: memberships.tenantId, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(tenants.agencyId, agency.id), eq(memberships.role, "owner"))),
      platform!.plans(),
    ]);
    const stats = await clientStats(rows.map((t) => t.id));
    const ownersBy = new Map<string, string[]>();
    for (const o of owners) ownersBy.set(o.tenantId, [...(ownersBy.get(o.tenantId) ?? []), o.email]);
    return {
      clients: rows.map((t) => {
        const plan = planRows.find((p) => p.id === t.plan);
        const s = stats.get(t.id);
        return {
          id: t.id,
          name: t.name,
          plan: t.plan,
          planName: plan ? { en: plan.nameEn, fr: plan.nameFr } : null,
          status: t.status,
          suspendedBy: t.suspendedBy,
          billingMode: t.agencyBillingMode,
          owners: ownersBy.get(t.id) ?? [],
          createdAt: t.createdAt,
          assistants: Number(s?.bots ?? 0),
          activeAssistants: Number(s?.active_bots ?? 0),
          questions: Number(s?.questions ?? 0),
          monthlyLimit: effectiveMonthlyLimit(plan?.monthlyQuestions ?? 0, t.monthlyQuestionLimit),
        };
      }),
    };
  });

  app.post<AgencyParams>(
    "/v1/agencies/:agencyId/clients",
    { preHandler: requireUser },
    async (request, reply) => {
      const { agency } = await requireActiveAgency(request, "admin");
      const input = agencyClientSchema.parse(request.body);
      if (!agency.billingModes.includes(input.billingMode)) {
        throw new HttpError(400, "billing_mode_not_allowed", "Your agency can't use this billing mode.");
      }
      const user = request.user!;
      const tenant = await db.transaction(async (tx) => {
        // Serialise this agency's new clients so two at once can't both pass the trial cap.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agency-clients:${agency.id}`}))`);
        const [trial] = await tx
          .select({ n: count() })
          .from(tenants)
          .where(and(eq(tenants.agencyId, agency.id), eq(tenants.plan, TRIAL_PLAN)));
        if ((trial?.n ?? 0) >= agency.trialClientCap) {
          throw new HttpError(
            403,
            "trial_cap_reached",
            `Your agency can have up to ${agency.trialClientCap} clients on the trial plan at once.`,
          );
        }
        const [created] = await tx
          .insert(tenants)
          .values({
            name: input.name,
            slug: slugify(input.name),
            plan: TRIAL_PLAN,
            ownerLanguage: input.ownerLanguage ?? user.uiLanguage,
            agencyId: agency.id,
            agencyBillingMode: input.billingMode,
            agencyJoinedAt: new Date(),
          })
          .returning();
        await tx.execute(sql`select set_config('app.tenant_id', ${created!.id}, true)`);
        await audit(tx, {
          tenantId: created!.id,
          actorUserId: user.id,
          action: "tenant.created",
          metadata: { agencyId: agency.id, billingMode: input.billingMode },
        });
        await logAgency(tx, {
          agencyId: agency.id,
          actorUserId: user.id,
          action: "client.created",
          tenantId: created!.id,
          metadata: { name: input.name, billingMode: input.billingMode },
        });
        return created!;
      });
      return reply.code(201).send({ client: { id: tenant.id, name: tenant.name, plan: tenant.plan } });
    },
  );

  app.patch<ClientParams>(
    "/v1/agencies/:agencyId/clients/:tenantId",
    { preHandler: requireUser },
    async (request) => {
      const { agency } = await requireActiveAgency(request, "admin");
      const tenant = await clientOf(agency.id, request.params.tenantId);
      const input = agencyClientUpdateSchema.parse(request.body);
      if (input.status && input.status !== tenant.status) {
        // Our operators' suspensions (abuse, unpaid wholesale) are theirs to lift, not the agency's.
        if (tenant.suspendedBy === "operator") {
          throw new HttpError(
            403,
            "suspended_by_operator",
            "This business was suspended by us. Contact support.",
          );
        }
        await db
          .update(tenants)
          .set({ status: input.status, suspendedBy: input.status === "suspended" ? "agency" : null })
          .where(eq(tenants.id, tenant.id));
        await logAgency(db, {
          agencyId: agency.id,
          actorUserId: request.user!.id,
          action: input.status === "suspended" ? "client.suspended" : "client.reactivated",
          tenantId: tenant.id,
        });
      }
      return { client: { id: tenant.id, status: input.status ?? tenant.status } };
    },
  );

  /** Makes an existing account the client's owner (they then sign in and see their business). */
  app.post<ClientParams>(
    "/v1/agencies/:agencyId/clients/:tenantId/owner",
    { preHandler: requireUser },
    async (request, reply) => {
      const { agency } = await requireActiveAgency(request, "admin");
      const tenant = await clientOf(agency.id, request.params.tenantId);
      const { email } = agencyClientOwnerSchema.parse(request.body);
      const [owner] = await db
        .select({ id: users.id, platformRole: users.platformRole })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!owner) {
        throw new HttpError(
          404,
          "account_not_found",
          "No account uses this email. Ask the owner to sign up first, then add them.",
        );
      }
      if (owner.platformRole)
        throw new HttpError(400, "staff_account", "Staff accounts can't own a business.");
      const policies = await platform!.policies();
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tenant-owner:${owner.id}`}))`);
        const [owned] = await tx
          .select({ n: count() })
          .from(memberships)
          .where(and(eq(memberships.userId, owner.id), eq(memberships.role, "owner")));
        if ((owned?.n ?? 0) >= policies.maxBusinessesPerAccount) {
          throw new HttpError(
            403,
            "business_limit_reached",
            "This account already owns as many businesses as allowed.",
          );
        }
        try {
          await tx.insert(memberships).values({ tenantId: tenant.id, userId: owner.id, role: "owner" });
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict("This account already belongs to the business.");
          throw err;
        }
        await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
        await audit(tx, {
          tenantId: tenant.id,
          actorUserId: request.user!.id,
          action: "member.added",
          metadata: { email, role: "owner", agencyId: agency.id },
        });
        await logAgency(tx, {
          agencyId: agency.id,
          actorUserId: request.user!.id,
          action: "client.owner_added",
          tenantId: tenant.id,
          metadata: { email },
        });
      });
      return reply.code(201).send({ ok: true });
    },
  );

  // ---- Team ---------------------------------------------------------------------------------

  app.get<AgencyParams>("/v1/agencies/:agencyId/members", { preHandler: requireUser }, async (request) => {
    const { agency } = await requireAgency(request);
    const members = await db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: agencyMembers.role,
        since: agencyMembers.createdAt,
      })
      .from(agencyMembers)
      .innerJoin(users, eq(users.id, agencyMembers.userId))
      .where(eq(agencyMembers.agencyId, agency.id))
      .orderBy(users.name);
    return { members };
  });

  app.post<AgencyParams>(
    "/v1/agencies/:agencyId/members",
    { preHandler: requireUser },
    async (request, reply) => {
      const { agency } = await requireAgency(request, "owner");
      const input = agencyMemberSchema.parse(request.body);
      const [member] = await db
        .select({ id: users.id, platformRole: users.platformRole })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (!member) {
        throw new HttpError(
          404,
          "account_not_found",
          "No account uses this email. Ask them to sign up first, then add them.",
        );
      }
      if (member.platformRole)
        throw new HttpError(400, "staff_account", "Staff accounts can't join an agency.");
      try {
        await db.insert(agencyMembers).values({ agencyId: agency.id, userId: member.id, role: input.role });
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict("This account is already on your team.");
        throw err;
      }
      await logAgency(db, {
        agencyId: agency.id,
        actorUserId: request.user!.id,
        action: "member.added",
        metadata: { email: input.email, role: input.role },
      });
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete<MemberParams>(
    "/v1/agencies/:agencyId/members/:userId",
    { preHandler: requireUser },
    async (request, reply) => {
      const { agency } = await requireAgency(request, "owner");
      const { userId } = request.params;
      if (!isUuid(userId)) throw notFound("Member");
      const [target] = await db
        .select({ role: agencyMembers.role })
        .from(agencyMembers)
        .where(and(eq(agencyMembers.agencyId, agency.id), eq(agencyMembers.userId, userId)))
        .limit(1);
      if (!target) throw notFound("Member");
      if (target.role === "owner") throw new HttpError(400, "owner", "The agency's owner can't be removed.");
      await db
        .delete(agencyMembers)
        .where(and(eq(agencyMembers.agencyId, agency.id), eq(agencyMembers.userId, userId)));
      await logAgency(db, {
        agencyId: agency.id,
        actorUserId: request.user!.id,
        action: "member.removed",
        metadata: { userId },
      });
      return reply.code(204).send();
    },
  );

  // ---- Branding -----------------------------------------------------------------------------

  app.patch<AgencyParams>("/v1/agencies/:agencyId/branding", { preHandler: requireUser }, async (request) => {
    const { agency, role } = await requireAgency(request, "admin");
    const input = agencyBrandingSchema.parse(request.body);
    const branding = { ...agency.branding };
    for (const [key, value] of Object.entries(input) as [keyof typeof branding, string | null][]) {
      if (value === null) delete branding[key];
      else (branding as Record<string, string>)[key] = value;
    }
    const [updated] = await db
      .update(agencies)
      .set({ branding })
      .where(eq(agencies.id, agency.id))
      .returning();
    await logAgency(db, {
      agencyId: agency.id,
      actorUserId: request.user!.id,
      action: "branding.updated",
      metadata: input,
    });
    return { agency: publicAgency(updated!, role) };
  });

  // ---- Activity -----------------------------------------------------------------------------

  app.get<AgencyParams>("/v1/agencies/:agencyId/activity", { preHandler: requireUser }, async (request) => {
    const { agency } = await requireAgency(request, "admin");
    const entries = await db
      .select({
        id: agencyAuditLogs.id,
        action: agencyAuditLogs.action,
        tenantId: agencyAuditLogs.tenantId,
        tenantName: tenants.name,
        metadata: agencyAuditLogs.metadata,
        createdAt: agencyAuditLogs.createdAt,
        actor: users.email,
      })
      .from(agencyAuditLogs)
      .leftJoin(users, eq(users.id, agencyAuditLogs.actorUserId))
      .leftJoin(tenants, eq(tenants.id, agencyAuditLogs.tenantId))
      .where(eq(agencyAuditLogs.agencyId, agency.id))
      .orderBy(desc(agencyAuditLogs.createdAt))
      .limit(100);
    return { entries };
  });
}
