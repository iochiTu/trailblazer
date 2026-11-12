import {
  botKeys,
  bots,
  type OnboardingMark,
  onboardings,
  operatorAuditLogs,
  tenants,
  users,
  withTenant,
} from "@traiblazer/db";
import {
  createOnboardingSchema,
  MANUAL_ONBOARDING_STEPS,
  type OnboardingStep,
  updateOnboardingSchema,
} from "@traiblazer/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { dueAfterOneWorkingDay, onboardingFacts, onboardingSteps } from "../lib/onboarding.js";
import { requireSuperAdmin } from "../plugins/auth.js";

type IdParams = { Params: { id: string } };

/** Checklists shown in the console. */
const LIST_LIMIT = 200;

/**
 * Done-for-you onboarding checklist (operator console, super admins only; PLAN §7):
 *   GET    /v1/operator/onboardings              every checklist, with its steps and timing
 *   POST   /v1/operator/onboardings              start one for a business
 *   PATCH  /v1/operator/onboardings/:id          when the materials arrived, the note, or one step
 *   POST   /v1/operator/onboardings/:id/go-live  publish the page (once the owner reviewed it)
 *   DELETE /v1/operator/onboardings/:id          remove the checklist (the business stays)
 *
 * Sources, page content, services, photos and go-live are checked from the business's own data;
 * staff tick the owner's review and the link on the Google listing, and can mark any step but
 * go-live as not needed. The page is due one working day after the materials arrived.
 */
export async function onboardingRoutes(app: FastifyInstance, { db, config }: AppContext) {
  const guard = { preHandler: requireSuperAdmin };

  const log = (request: FastifyRequest, action: string, targetId: string, metadata: object = {}) =>
    db.insert(operatorAuditLogs).values({
      actorUserId: request.user!.id,
      action,
      targetType: "onboarding",
      targetId,
      metadata: metadata as Record<string, unknown>,
    });

  /** The checklist with its business, or 404. */
  const find = async (id: string) => {
    if (!isUuid(id)) throw notFound("Checklist");
    const [row] = await db
      .select({ onboarding: onboardings, tenant: tenants })
      .from(onboardings)
      .innerJoin(tenants, eq(tenants.id, onboardings.tenantId))
      .where(eq(onboardings.id, id))
      .limit(1);
    if (!row) throw notFound("Checklist");
    return row;
  };

  /** A checklist as the console shows it: steps checked against the business's data right now. */
  const present = async (
    onboarding: typeof onboardings.$inferSelect,
    tenant: { name: string; status: string },
    createdBy: string | null,
  ) => {
    const inside = await withTenant(db, onboarding.tenantId, async (tx) => {
      const facts = await onboardingFacts(tx, onboarding.botId);
      const [bot] = await tx
        .select({ name: bots.name, pageSlug: bots.pageSlug })
        .from(bots)
        .where(eq(bots.id, onboarding.botId))
        .limit(1);
      const [key] = await tx
        .select({ publicKey: botKeys.publicKey })
        .from(botKeys)
        .where(and(eq(botKeys.botId, onboarding.botId), isNull(botKeys.revokedAt)))
        .orderBy(asc(botKeys.createdAt))
        .limit(1);
      return { facts, bot, publicKey: key?.publicKey ?? null };
    });
    if (!inside.facts || !inside.bot) throw notFound("Assistant");

    // Published by the owner rather than from the checklist: the first time it is seen live.
    let liveAt = onboarding.liveAt;
    if (inside.facts.live && !liveAt) {
      liveAt = new Date();
      await db
        .update(onboardings)
        .set({ liveAt })
        .where(and(eq(onboardings.id, onboarding.id), isNull(onboardings.liveAt)));
    }

    const steps = onboardingSteps(inside.facts, onboarding.marks);
    const pageUrl = inside.bot.pageSlug
      ? `${config.PUBLIC_URL}/${inside.bot.pageSlug}`
      : inside.publicKey
        ? `${config.PUBLIC_URL}/c/${inside.publicKey}`
        : null;
    return {
      id: onboarding.id,
      tenantId: onboarding.tenantId,
      botId: onboarding.botId,
      business: tenant.name,
      businessStatus: tenant.status,
      assistant: inside.bot.name,
      pageUrl,
      receivedAt: onboarding.receivedAt,
      dueAt: onboarding.dueAt,
      liveAt,
      note: onboarding.note,
      createdBy,
      createdAt: onboarding.createdAt,
      facts: inside.facts,
      steps,
      /** Every step done or not needed. */
      finished: steps.every((s) => s.state !== "open"),
    };
  };

  const presentById = async (id: string) => {
    const { onboarding, tenant } = await find(id);
    const [creator] = onboarding.createdBy
      ? await db.select({ email: users.email }).from(users).where(eq(users.id, onboarding.createdBy))
      : [];
    return present(onboarding, tenant, creator?.email ?? null);
  };

  app.get("/v1/operator/onboardings", guard, async () => {
    const rows = await db
      .select({ onboarding: onboardings, tenant: tenants, createdBy: users.email })
      .from(onboardings)
      .innerJoin(tenants, eq(tenants.id, onboardings.tenantId))
      .leftJoin(users, eq(users.id, onboardings.createdBy))
      .orderBy(asc(onboardings.dueAt))
      .limit(LIST_LIMIT);
    const list = [];
    for (const { onboarding, tenant, createdBy } of rows) {
      list.push(await present(onboarding, tenant, createdBy));
    }
    return { onboardings: list };
  });

  app.post("/v1/operator/onboardings", guard, async (request, reply) => {
    const input = createOnboardingSchema.parse(request.body);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
    if (!tenant) throw notFound("Business");
    if (tenant.kind === "demo") {
      throw badRequest("This is still a prospect demo. Hand it over to the owner's account first.");
    }
    const botId = await withTenant(db, tenant.id, async (tx) => {
      const [bot] = await tx
        .select({ id: bots.id })
        .from(bots)
        .where(input.botId ? eq(bots.id, input.botId) : undefined)
        .orderBy(asc(bots.createdAt))
        .limit(1);
      return bot?.id ?? null;
    });
    if (!botId) {
      throw badRequest(
        input.botId ? "This assistant isn't one of the business's" : "This business has no assistant yet",
      );
    }
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const [created] = await db
      .insert(onboardings)
      .values({
        tenantId: tenant.id,
        botId,
        receivedAt,
        dueAt: dueAfterOneWorkingDay(receivedAt),
        note: input.note || null,
        createdBy: request.user!.id,
      })
      .onConflictDoNothing({ target: onboardings.tenantId })
      .returning();
    if (!created) {
      throw new HttpError(409, "onboarding_exists", "This business already has a checklist");
    }
    await log(request, "onboarding.started", created.id, { business: tenant.name });
    return reply.code(201).send({ onboarding: await present(created, tenant, request.user!.email) });
  });

  app.patch<IdParams>("/v1/operator/onboardings/:id", guard, async (request) => {
    const { onboarding } = await find(request.params.id);
    const input = updateOnboardingSchema.parse(request.body);
    const changes: Partial<typeof onboardings.$inferInsert> = {};
    if (input.receivedAt) {
      const receivedAt = new Date(input.receivedAt);
      changes.receivedAt = receivedAt;
      changes.dueAt = dueAfterOneWorkingDay(receivedAt);
    }
    if (input.note !== undefined) changes.note = input.note || null;
    if (input.step) {
      const { id, state } = input.step;
      if (state === "done" && !MANUAL_ONBOARDING_STEPS.includes(id as OnboardingStep)) {
        throw badRequest(
          "This step is checked from the business's information. Mark it as not needed if it doesn't apply.",
        );
      }
      const marks: Record<string, OnboardingMark> = { ...onboarding.marks };
      if (state === "open") delete marks[id];
      else marks[id] = { state, at: new Date().toISOString(), by: request.user!.email };
      changes.marks = marks;
    }
    await db.update(onboardings).set(changes).where(eq(onboardings.id, onboarding.id));
    await log(request, "onboarding.updated", onboarding.id, {
      fields: Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined),
      ...(input.step ? { step: input.step } : {}),
    });
    return { onboarding: await presentById(onboarding.id) };
  });

  app.post<IdParams>("/v1/operator/onboardings/:id/go-live", guard, async (request) => {
    const { onboarding, tenant } = await find(request.params.id);
    if (onboarding.marks.review?.state !== "done") {
      throw new HttpError(
        409,
        "owner_review_missing",
        "The owner hasn't reviewed the page yet. Mark their review done first.",
      );
    }
    if (tenant.status !== "active") {
      throw new HttpError(409, "business_suspended", "This business is suspended");
    }
    // Support access: published like an admin of the business, and written to its activity log.
    await withTenant(db, tenant.id, async (tx) => {
      const updated = await tx
        .update(bots)
        .set({ status: "active", hostedPageEnabled: true })
        .where(eq(bots.id, onboarding.botId))
        .returning({ id: bots.id });
      if (!updated.length) throw notFound("Assistant");
      await audit(tx, {
        tenantId: tenant.id,
        actorUserId: request.user!.id,
        action: "bot.updated",
        targetType: "bot",
        targetId: onboarding.botId,
        metadata: { fields: ["status", "hostedPageEnabled"], via: "onboarding" },
      });
    });
    await db
      .update(onboardings)
      .set({ liveAt: new Date() })
      .where(and(eq(onboardings.id, onboarding.id), isNull(onboardings.liveAt)));
    await log(request, "onboarding.live", onboarding.id, { business: tenant.name });
    return { onboarding: await presentById(onboarding.id) };
  });

  app.delete<IdParams>("/v1/operator/onboardings/:id", guard, async (request, reply) => {
    const { onboarding, tenant } = await find(request.params.id);
    await db.delete(onboardings).where(eq(onboardings.id, onboarding.id));
    await log(request, "onboarding.removed", onboarding.id, { business: tenant.name });
    return reply.code(204).send();
  });
}
