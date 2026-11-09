import { auditLogs, memberships, tenants, users, withTenant } from "@traiblazer/db";
import { createTenantSchema } from "@traiblazer/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { slugify } from "../lib/ids.js";
import { isSuperAdmin, requireTenantRole, requireUser } from "../plugins/auth.js";

type TenantParams = { Params: { tenantId: string } };

export async function tenantRoutes(app: FastifyInstance, { db, platform }: AppContext) {
  app.get("/v1/tenants", { preHandler: requireUser }, async (request) => {
    const rows = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, request.user!.id))
      .orderBy(tenants.name);
    return { tenants: rows };
  });

  app.post("/v1/tenants", { preHandler: requireUser }, async (request, reply) => {
    const user = request.user!;
    // Staff accounts stay separate from businesses; they help businesses through support access.
    if (isSuperAdmin(user)) {
      throw new HttpError(
        403,
        "staff_account",
        "Staff accounts can't own businesses. Use a separate account.",
      );
    }
    const input = createTenantSchema.parse(request.body);
    // New businesses start on the operators' default plan (if it is still offered).
    const [policies, allPlans] = await Promise.all([platform!.policies(), platform!.plans()]);
    const plan = allPlans.find((p) => p.id === policies.defaultPlan && p.active)?.id ?? "trial";

    const tenant = await db.transaction(async (tx) => {
      // One account can own a limited number of businesses (operator policy). The advisory lock
      // serialises this account's sign-ups so two requests at once can't both pass the count.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tenant-owner:${user.id}`}))`);
      const [owned] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.role, "owner")));
      if ((owned?.count ?? 0) >= policies.maxBusinessesPerAccount) {
        throw new HttpError(
          403,
          "business_limit_reached",
          `An account can own up to ${policies.maxBusinessesPerAccount} businesses.`,
        );
      }
      const [created] = await tx
        .insert(tenants)
        .values({
          name: input.name,
          slug: slugify(input.name),
          plan,
          ownerLanguage: input.ownerLanguage ?? user.uiLanguage,
        })
        .returning();
      await tx.insert(memberships).values({ tenantId: created!.id, userId: user.id, role: "owner" });
      // Audit log is tenant-scoped (RLS): set the tenant context for the rest of this transaction.
      await tx.execute(sql`select set_config('app.tenant_id', ${created!.id}, true)`);
      await audit(tx, { tenantId: created!.id, actorUserId: user.id, action: "tenant.created" });
      return created!;
    });

    return reply.code(201).send({ tenant: { ...tenant, role: "owner" } });
  });

  app.get<TenantParams>(
    "/v1/tenants/:tenantId",
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, request.tenant!.id)).limit(1);
      if (!tenant) throw notFound("Business");
      return { tenant: { ...tenant, role: request.tenant!.role, support: request.tenant!.support } };
    },
  );

  app.get<TenantParams>(
    "/v1/tenants/:tenantId/members",
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const members = await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          role: memberships.role,
          since: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, request.tenant!.id))
        .orderBy(users.name);
      return { members };
    },
  );

  app.get<TenantParams>(
    "/v1/tenants/:tenantId/audit-logs",
    { preHandler: requireTenantRole(db, "admin") },
    async (request) => {
      const entries = await withTenant(db, request.tenant!.id, (tx) =>
        tx.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100),
      );
      return { entries };
    },
  );
}
