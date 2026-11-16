import { addContactMessage, type TextReach, textReach } from "@traiblazer/core";
import {
  contactMessages,
  contacts,
  conversations,
  leads,
  type MessageFlags,
  messages,
  outboundMessages,
  users,
  withTenant,
} from "@traiblazer/db";
import { contactMessageSchema } from "@traiblazer/shared";
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { forbidden, HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type ListRoute = { Params: { tenantId: string }; Querystring: { q?: string } };
type ContactRoute = { Params: { tenantId: string; contactId: string } };

/** Why a message to a contact can't go out, in words (the portal shows its own, by code). */
const REFUSALS = {
  no_phone: "This contact has no phone number",
  no_email: "This contact has no email address",
  no_number: "Your assistant has no phone number for texting yet",
  opted_out: "This contact asked not to get text messages",
  capped: "Today's limit for text messages was reached",
} as const;

/** One thing that happened with a contact, oldest first on their page. */
type TimelineItem =
  | {
      type: "request";
      id: string;
      at: Date;
      botId: string;
      kind: string;
      status: string;
      urgent: boolean;
      channel: string;
      message: string;
    }
  /** A text in their thread with the assistant's number: theirs, or the assistant's answer. */
  | { type: "text"; id: string; at: Date; from: "contact" | "assistant"; body: string }
  /** What the team sent or noted. A text's status is its delivery; an email's, whether it went. */
  | {
      type: "team";
      id: string;
      at: Date;
      channel: string;
      subject: string | null;
      body: string;
      status: string;
      error: string | null;
      authorName: string | null;
    };

/**
 * Contacts: everyone who left a request with one of the business's assistants, texted or called
 * its number, and what the team sent them since.
 *
 *   GET    /v1/tenants/:t/contacts[?q=]             last heard from first; `q` searches name, email and number
 *   GET    /v1/tenants/:t/contacts/:id              the contact, how they can be reached, and their timeline
 *   POST   /v1/tenants/:t/contacts/:id/messages     send a text or an email, record a call, add a note
 *   DELETE /v1/tenants/:t/contacts/:id              remove the contact and what the team wrote (e.g. on
 *                                                   their request); their requests stay, unlinked
 *
 * Every member can read; sending, noting and removing need the editor role and are audited
 * (without the message). Support staff can add notes but don't write to a business's customers.
 */
export async function contactRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const base = "/v1/tenants/:tenantId/contacts";

  /** Texting needs a provider on this deployment, then a number the contact can be reached from. */
  const reachByText = async (
    tx: Parameters<typeof textReach>[0],
    contact: { id: string; phone: string | null },
  ): Promise<TextReach> =>
    ctx.telephony || !contact.phone ? textReach(tx, contact) : { ok: false, reason: "no_number" };

  app.get<ListRoute>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const q = request.query.q?.trim().slice(0, 100) ?? "";
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const digits = q.replace(/\D/g, "");
    return withTenant(db, request.tenant!.id, async (tx) => {
      // Table names written out: with one table in the query, drizzle leaves them off columns.
      const requests = (filter: string) =>
        sql<number>`(select count(*)::int from leads l where l.contact_id = "contacts"."id" and l.channel <> 'playground' and ${sql.raw(filter)})`;
      const list = await tx
        .select({
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
          email: contacts.email,
          lastActivityAt: contacts.lastActivityAt,
          requests: requests("true"),
          openRequests: requests("l.status <> 'done'"),
          urgentRequests: requests("l.urgent and l.status <> 'done'"),
          /** What they last asked for, to recognise them by. */
          lastRequest: sql<
            string | null
          >`(select l.message from leads l where l.contact_id = "contacts"."id" and l.channel <> 'playground' order by l.created_at desc limit 1)`,
        })
        .from(contacts)
        .where(
          q
            ? or(
                ilike(contacts.name, like),
                ilike(contacts.email, like),
                digits.length >= 3 ? ilike(contacts.phone, `%${digits}%`) : undefined,
              )
            : undefined,
        )
        .orderBy(desc(contacts.lastActivityAt))
        .limit(200);
      const [counts] = await tx.select({ total: sql<number>`count(*)::int` }).from(contacts);
      return { contacts: list, total: counts?.total ?? 0 };
    });
  });

  app.get<ContactRoute>(
    `${base}/:contactId`,
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const { contactId } = request.params;
      if (!isUuid(contactId)) throw notFound("Contact");
      return withTenant(db, request.tenant!.id, async (tx) => {
        const [contact] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
        if (!contact) throw notFound("Contact");

        const asked = await tx
          .select({
            id: leads.id,
            at: leads.createdAt,
            botId: leads.botId,
            kind: leads.kind,
            status: leads.status,
            urgent: leads.urgent,
            channel: leads.channel,
            message: leads.message,
          })
          .from(leads)
          .where(and(eq(leads.contactId, contactId), ne(leads.channel, "playground")))
          .orderBy(desc(leads.createdAt))
          .limit(100);

        // Their text thread with the assistant's number. What the team wrote is in it too (so the
        // assistant knows), and comes from `contact_messages` below instead.
        const texts = contact.phone
          ? await tx
              .select({
                id: messages.id,
                at: messages.createdAt,
                role: messages.role,
                body: messages.content,
                flags: messages.flags,
              })
              .from(messages)
              .innerJoin(conversations, eq(conversations.id, messages.conversationId))
              .where(and(eq(conversations.channel, "sms"), eq(conversations.visitorId, contact.phone)))
              .orderBy(desc(messages.createdAt))
              .limit(200)
          : [];

        const written = await tx
          .select({
            id: contactMessages.id,
            at: contactMessages.createdAt,
            channel: contactMessages.channel,
            subject: contactMessages.subject,
            body: contactMessages.body,
            status: contactMessages.status,
            error: contactMessages.error,
            authorName: users.name,
            textStatus: outboundMessages.status,
            textError: outboundMessages.error,
          })
          .from(contactMessages)
          .leftJoin(users, eq(users.id, contactMessages.authorUserId))
          .leftJoin(outboundMessages, eq(outboundMessages.id, contactMessages.outboundMessageId))
          .where(eq(contactMessages.contactId, contactId))
          .orderBy(desc(contactMessages.createdAt))
          .limit(200);

        const timeline: TimelineItem[] = [
          ...asked.map((lead) => ({ type: "request" as const, ...lead })),
          ...texts
            .filter((m) => !(m.flags as MessageFlags | null)?.staff)
            .map((m) => ({
              type: "text" as const,
              id: m.id,
              at: m.at,
              from: m.role === "user" ? ("contact" as const) : ("assistant" as const),
              body: m.body,
            })),
          ...written.map(({ textStatus, textError, ...m }) => ({
            type: "team" as const,
            ...m,
            status: m.channel === "sms" ? (textStatus ?? m.status) : m.status,
            error: m.channel === "sms" ? textError : m.error,
          })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime());

        const text = await reachByText(tx, contact);
        return {
          contact,
          /** Whether a text or an email can be sent from here, and why not. */
          reach: {
            sms: text.ok ? { ok: true, from: text.from } : { ok: false, reason: text.reason },
            email: contact.email ? { ok: true } : { ok: false, reason: "no_email" },
          },
          timeline,
        };
      });
    },
  );

  app.post<ContactRoute>(
    `${base}/:contactId/messages`,
    {
      preHandler: requireTenantRole(db, "editor"),
      // A person writing, not a mailing: well above what a busy day needs.
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { contactId } = request.params;
      if (!isUuid(contactId)) throw notFound("Contact");
      const input = contactMessageSchema.parse(request.body);
      const outgoing = input.channel === "sms" || input.channel === "email";
      // Support staff look after the account; they don't speak for the business to its customers.
      if (outgoing && request.tenant!.support) throw forbidden();
      const tenantId = request.tenant!.id;
      const authorUserId = request.user!.id;

      const message = await withTenant(db, tenantId, async (tx) => {
        if (input.channel === "sms" && !ctx.telephony) {
          throw new HttpError(409, "contact_no_number", REFUSALS.no_number);
        }
        const result = await addContactMessage(tx, {
          tenantId,
          contactId,
          authorUserId,
          channel: input.channel,
          subject: input.channel === "email" ? input.subject : null,
          body: input.body,
        });
        if (!result.ok) {
          if (result.reason === "not_found") throw notFound("Contact");
          throw new HttpError(409, `contact_${result.reason}`, REFUSALS[result.reason]);
        }
        await audit(tx, {
          tenantId,
          actorUserId: authorUserId,
          action: "contact.message",
          targetType: "contact",
          targetId: contactId,
          metadata: { channel: input.channel },
        });
        return result.message;
      });
      return reply.code(201).send({
        message: {
          type: "team",
          id: message.id,
          at: message.createdAt,
          channel: message.channel,
          subject: message.subject,
          body: message.body,
          status: message.status,
          error: message.error,
          authorName: request.user!.name,
        },
      });
    },
  );

  app.delete<ContactRoute>(
    `${base}/:contactId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { contactId } = request.params;
      if (!isUuid(contactId)) throw notFound("Contact");
      await withTenant(db, request.tenant!.id, async (tx) => {
        const [gone] = await tx
          .delete(contacts)
          .where(eq(contacts.id, contactId))
          .returning({ id: contacts.id });
        if (!gone) throw notFound("Contact");
        await audit(tx, {
          tenantId: request.tenant!.id,
          actorUserId: request.user?.id ?? null,
          action: "contact.delete",
          targetType: "contact",
          targetId: contactId,
        });
      });
      return reply.code(204).send();
    },
  );
}
