import {
  type Db,
  type MemberRole,
  memberships,
  operatorAuditLogs,
  tenants,
  withTenant,
} from "@traiblazer/db";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getSessionUser, SESSION_COOKIE, type SessionUser } from "../auth/sessions.js";
import { agencyAccess, logAgency } from "../lib/agencies.js";
import { audit } from "../lib/audit.js";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    /**
     * Set by requireTenantRole for tenant-scoped routes. `via` says how the user got in: as a
     * member, as a Traiblazer super admin helping (`support` is then true), or as a user of the
     * agency that manages the business (`agencyId` is then set).
     */
    tenant: {
      id: string;
      role: MemberRole;
      support: boolean;
      via: "member" | "support" | "agency";
      agencyId: string | null;
    } | null;
  }
}

const roleRank: Record<MemberRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** Role a super admin gets in a business they're supporting: can change settings, not ownership. */
export const SUPPORT_ROLE: MemberRole = "admin";

/** Role an agency's users get in its clients: they run the assistant, the owner keeps ownership. */
export const AGENCY_ROLE: MemberRole = "admin";

export function hasRole(actual: MemberRole, required: MemberRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

export const isSuperAdmin = (user: SessionUser | null) => user?.platformRole === "super_admin";

/** onRequest hook: resolves the session cookie into request.user (or null). */
export function loadUser(db: Db) {
  return async (request: FastifyRequest) => {
    request.user = null;
    request.tenant = null;
    const token = request.cookies[SESSION_COOKIE];
    if (token) request.user = await getSessionUser(db, token);
  };
}

export async function requireUser(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user) throw unauthorized();
}

/** preHandler for the operator console. Everyone but super admins gets 404 so it stays hidden. */
export async function requireSuperAdmin(request: FastifyRequest): Promise<void> {
  if (!request.user) throw unauthorized();
  if (!isSuperAdmin(request.user)) throw notFound("Page");
}

/**
 * preHandler for routes under /v1/tenants/:tenantId. Verifies membership and minimum role and sets
 * request.tenant. Non-members get 404 (not 403) so tenant ids can't be probed. Super admins (who
 * can never be members) get support access with the SUPPORT_ROLE; users of the active agency that
 * manages the business get the AGENCY_ROLE. Both are audited.
 */
export function requireTenantRole(db: Db, minimum: MemberRole) {
  return async (request: FastifyRequest<{ Params: { tenantId: string } }>) => {
    if (!request.user) throw unauthorized();
    const { tenantId } = request.params;
    if (!isUuid(tenantId)) throw notFound("Business");
    if (isSuperAdmin(request.user)) {
      const [exists] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!exists) throw notFound("Business");
      if (!hasRole(SUPPORT_ROLE, minimum)) throw forbidden();
      request.tenant = { id: tenantId, role: SUPPORT_ROLE, support: true, via: "support", agencyId: null };
      return;
    }
    const [membership] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, request.user.id)))
      .limit(1);
    if (membership) {
      if (!hasRole(membership.role, minimum)) throw forbidden();
      request.tenant = { id: tenantId, role: membership.role, support: false, via: "member", agencyId: null };
      return;
    }
    const viaAgency = await agencyAccess(db, request.user.id, tenantId);
    if (!viaAgency) throw notFound("Business");
    if (!hasRole(AGENCY_ROLE, minimum)) throw forbidden();
    request.tenant = {
      id: tenantId,
      role: AGENCY_ROLE,
      support: false,
      via: "agency",
      agencyId: viaAgency.agencyId,
    };
  };
}

/**
 * onSend hook: every successful change a super admin or an agency's user makes in a business is
 * recorded in that business's own audit log (so the owner can see it) and in the operator's or the
 * agency's audit log, before the response goes out.
 */
export function auditSupportChanges(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const tenant = request.tenant;
    if (!tenant || tenant.via === "member" || !request.user) return payload;
    if (request.method === "GET" || request.method === "HEAD" || reply.statusCode >= 400) return payload;
    const metadata = { method: request.method, route: request.routeOptions.url ?? request.url };
    if (tenant.via === "agency" && tenant.agencyId) {
      const agencyId = tenant.agencyId;
      try {
        await withTenant(db, tenant.id, (tx) =>
          audit(tx, {
            tenantId: tenant.id,
            actorUserId: request.user!.id,
            action: "agency.change",
            metadata: { ...metadata, agencyId },
          }),
        );
        await logAgency(db, {
          agencyId,
          actorUserId: request.user.id,
          action: "client.change",
          tenantId: tenant.id,
          metadata,
        });
      } catch (err) {
        request.log.error({ err }, "failed to record agency change");
      }
      return payload;
    }
    try {
      await withTenant(db, tenant.id, (tx) =>
        audit(tx, { tenantId: tenant.id, actorUserId: request.user!.id, action: "support.change", metadata }),
      );
      await db.insert(operatorAuditLogs).values({
        actorUserId: request.user.id,
        action: "support.change",
        targetType: "tenant",
        targetId: tenant.id,
        metadata,
      });
    } catch (err) {
      request.log.error({ err }, "failed to record support change");
    }
    return payload;
  };
}
