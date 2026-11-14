import { phoneSpendMicros } from "@traiblazer/core";
import {
  bots,
  outboundMessages,
  phoneAlertRequests,
  phoneCallModes,
  phoneNumbers,
  resolvePhoneNumber,
  smsOptOuts,
  withTenant,
} from "@traiblazer/db";
import { formatPhone, toE164 } from "@traiblazer/telephony";
import { and, count, eq, gte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string } };

const attachSchema = z.object({ number: z.string().trim().min(7).max(32) });
/** The daily spend cap a business may set: 50 cents to 200 dollars. */
const CAP_CENTS = { min: 50, max: 20_000 };
const settingsSchema = z
  .object({
    smsEnabled: z.boolean(),
    callMode: z.enum(phoneCallModes),
    dailyCapCents: z.number().int().min(CAP_CENTS.min).max(CAP_CENTS.max),
    /** The owner's mobile number for alerts by text; null or "" turns them off. */
    alertNumber: z.string().trim().max(32).nullable(),
    alertRequests: z.enum(phoneAlertRequests),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

const columns = {
  id: phoneNumbers.id,
  e164: phoneNumbers.e164,
  provider: phoneNumbers.provider,
  smsEnabled: phoneNumbers.smsEnabled,
  callMode: phoneNumbers.callMode,
  dailyCapCents: phoneNumbers.dailyCapCents,
  alertNumber: phoneNumbers.alertNumber,
  alertRequests: phoneNumbers.alertRequests,
};
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const shown = <T extends { e164: string }>(row: T) => ({ ...row, display: formatPhone(row.e164) });

/**
 * An assistant's phone number (docs/PHONE_AND_SMS.md §4.1):
 *
 *   GET    /v1/tenants/:t/bots/:b/phone     the number and what it does, or null
 *   PUT    /v1/tenants/:t/bots/:b/phone     assign a number (Traiblazer staff, in support mode)
 *   PATCH  /v1/tenants/:t/bots/:b/phone     texting on or off; what a call does (admin)
 *   DELETE /v1/tenants/:t/bots/:b/phone     take the number away (Traiblazer staff)
 *
 * The number itself is bought and pointed at our webhooks at the provider by staff, so only staff
 * can assign or remove it; the business decides how it is used.
 */
export async function phoneRoutes(app: FastifyInstance, { db, telephony, config }: AppContext) {
  const webhookBase = (config.TELEPHONY_WEBHOOK_URL ?? config.PUBLIC_URL).replace(/\/$/, "");
  const base = "/v1/tenants/:tenantId/bots/:botId/phone";
  const forBot = async <T>(
    tenantId: string,
    botId: string,
    work: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>,
  ) => {
    if (!isUuid(botId)) throw notFound("Assistant");
    return withTenant(db, tenantId, async (tx) => {
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      return work(tx);
    });
  };

  app.get<BotParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { tenantId, botId } = request.params;
    const { row, stats } = await forBot(tenantId, botId, async (tx) => {
      const [row] = await tx.select(columns).from(phoneNumbers).where(eq(phoneNumbers.botId, botId)).limit(1);
      const [texts] = await tx
        .select({ n: count() })
        .from(outboundMessages)
        .where(and(eq(outboundMessages.botId, botId), gte(outboundMessages.createdAt, daysAgo(30))));
      const [stopped] = await tx.select({ n: count() }).from(smsOptOuts).where(eq(smsOptOuts.botId, botId));
      const spentMicros = row ? await phoneSpendMicros(tx, botId, new Date()) : 0;
      return {
        row,
        stats: {
          textsSent30Days: texts?.n ?? 0,
          optOuts: stopped?.n ?? 0,
          // What the number cost in the last 24 hours, against the daily cap.
          spentTodayCents: Math.round(spentMicros / 10_000),
        },
      };
    });
    const staff = Boolean(request.tenant?.support);
    return {
      phone: row ? shown(row) : null,
      // Phone and SMS are set up on this platform at all.
      available: Boolean(telephony),
      stats,
      // Only Traiblazer staff assign numbers; they also need the addresses to enter at the provider.
      canAssign: staff,
      webhooks:
        staff && telephony
          ? {
              sms: `${webhookBase}/v1/telephony/${telephony.id}/sms`,
              voice: `${webhookBase}/v1/telephony/${telephony.id}/voice`,
            }
          : null,
    };
  });

  app.put<BotParams>(base, { preHandler: requireTenantRole(db, "admin") }, async (request, reply) => {
    const { tenantId, botId } = request.params;
    if (!request.tenant?.support) throw forbidden();
    if (!telephony) throw new HttpError(409, "telephony_off", "Phone and SMS aren't set up on this platform");
    const e164 = toE164(attachSchema.parse(request.body).number);
    if (!e164) throw badRequest("Please enter the full phone number, e.g. +1 807 555 0142");
    // One assistant per number, across every business.
    const taken = await resolvePhoneNumber(db, e164);
    if (taken && taken.botId !== botId) {
      throw new HttpError(409, "number_taken", "That number already belongs to another assistant");
    }
    const row = await forBot(tenantId, botId, async (tx) => {
      // One number per assistant: assigning another replaces it.
      await tx.delete(phoneNumbers).where(eq(phoneNumbers.botId, botId));
      const [created] = await tx
        .insert(phoneNumbers)
        .values({ tenantId, botId, e164, provider: telephony.id })
        .returning(columns);
      await audit(tx, {
        tenantId,
        actorUserId: request.user!.id,
        action: "phone.assigned",
        targetType: "bot",
        targetId: botId,
        metadata: { e164 },
      });
      return created!;
    });
    return reply.code(201).send({ phone: shown(row) });
  });

  app.patch<BotParams>(base, { preHandler: requireTenantRole(db, "admin") }, async (request) => {
    const { tenantId, botId } = request.params;
    const input = settingsSchema.parse(request.body);
    const changes: Partial<typeof phoneNumbers.$inferInsert> = { ...input };
    if (input.alertNumber !== undefined) {
      const alertNumber = input.alertNumber ? toE164(input.alertNumber) : null;
      if (input.alertNumber && !alertNumber) {
        throw badRequest("Please enter the full mobile number, e.g. 807 555 0142");
      }
      changes.alertNumber = alertNumber;
    }
    // A higher cap takes effect at once, and reaching it again is announced again.
    if (input.dailyCapCents !== undefined) changes.capAlertedAt = null;
    const row = await forBot(tenantId, botId, async (tx) => {
      if (changes.alertNumber) {
        const [own] = await tx
          .select({ e164: phoneNumbers.e164 })
          .from(phoneNumbers)
          .where(eq(phoneNumbers.botId, botId))
          .limit(1);
        if (own?.e164 === changes.alertNumber) throw badRequest("That is the assistant's own number");
      }
      const [updated] = await tx
        .update(phoneNumbers)
        .set(changes)
        .where(and(eq(phoneNumbers.botId, botId)))
        .returning(columns);
      if (!updated) throw notFound("Phone number");
      await audit(tx, {
        tenantId,
        actorUserId: request.user!.id,
        action: "phone.updated",
        targetType: "bot",
        targetId: botId,
        // Which settings changed, not their values: the alert number is the owner's own phone.
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
    return { phone: shown(row) };
  });

  app.delete<BotParams>(base, { preHandler: requireTenantRole(db, "admin") }, async (request, reply) => {
    const { tenantId, botId } = request.params;
    if (!request.tenant?.support) throw forbidden();
    await forBot(tenantId, botId, async (tx) => {
      const [removed] = await tx
        .delete(phoneNumbers)
        .where(eq(phoneNumbers.botId, botId))
        .returning({ e164: phoneNumbers.e164 });
      if (!removed) throw notFound("Phone number");
      await audit(tx, {
        tenantId,
        actorUserId: request.user!.id,
        action: "phone.removed",
        targetType: "bot",
        targetId: botId,
        metadata: { e164: removed.e164 },
      });
    });
    return reply.code(204).send();
  });
}
