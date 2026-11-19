import type { AddonEvent } from "@traiblazer/addons";
import {
  jobs,
  leadKinds,
  leads,
  type MessageFlags,
  messageAttachments,
  messages,
  type Tx,
  withTenant,
} from "@traiblazer/db";
import type { LeadField } from "@traiblazer/industry-packs";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { contactFor } from "../../contacts/contacts.js";
import { JOB_TYPES, newJob } from "../../jobs.js";
import { countItemEvents, itemStatSurface } from "../../stats/item-stats.js";
import { clean, readContact, untypedContact } from "./contact.js";
import { defineTool, type ToolContext } from "./contract.js";

/** Most requests one conversation can leave (a visitor correcting a detail, not a flood). */
export const MAX_REQUESTS_PER_CONVERSATION = 3;
/** Most of the visitor's photos attached to one request (the newest). */
export const MAX_REQUEST_PHOTOS = 6;

/**
 * Passes a visitor's request to the business: saves it with the contact details the visitor typed,
 * the industry's details (vehicle, address…), the photos they sent and whether it is urgent, and
 * tells add-ons (the email notification). Urgent requests are also emailed by the platform at once.
 * This is how the assistant captures a lead or hands a conversation to a person. It never books,
 * orders or confirms anything itself.
 */
export const requestFollowUpTool = (fields: LeadField[], options: { items?: boolean } = {}) =>
  defineTool({
    name: "request_follow_up",
    description: `Pass a visitor's request to the business's staff so a person can follow up: a call back, a quote, a booking request, a question you couldn't answer, a complaint. It saves the request and notifies the business. It does not book, order or confirm anything.
Use it when the visitor asks to be contacted or to talk to a person, or accepts your offer to pass their request on. Offer it when you can't answer something the visitor needs, when they want something only staff can do, or when a workflow ends with the business following up.
Before calling it you need the visitor's name, at least one way to reach them (an email address or phone number that they typed in this conversation) and what they want. Ask for what is missing, one or two things at a time, and call it once you have them; don't ask the visitor to confirm again. Never guess or make up contact details.
If you already passed a request on in this conversation and the visitor adds or corrects something (a detail, a time, another way to reach them), call it again with the whole request as it now stands: the request the business has is updated, not doubled.
After it succeeds, tell the visitor their request was passed on and the business will get back to them; don't promise when. If it fails, say so and give the business's phone or email from <business_profile> instead.`,
    input: z.object({
      kind: z
        .enum(leadKinds)
        .describe(
          'What the visitor wants: "callback" (be called or emailed back), "quote" (a price for a job or order), "booking" (a reservation or appointment staff must arrange), "question" (something you couldn\'t answer), "complaint", or "other".',
        ),
      name: z.string().trim().min(1).max(120).describe("The visitor's name, as they gave it."),
      email: z
        .string()
        .trim()
        .max(254)
        .nullish()
        .describe(
          "The visitor's email address, exactly as they typed it. Leave out if they didn't give one.",
        ),
      phone: z
        .string()
        .trim()
        .max(40)
        .nullish()
        .describe("The visitor's phone number, as they typed it. Leave out if they didn't give one."),
      request: z
        .string()
        .trim()
        .min(3)
        .max(1000)
        .describe(
          "What the visitor wants, in one to three sentences for the business's staff: what, for when, how many. Keep the visitor's own details. Leave out health, legal, financial or other sensitive details; name only the general topic.",
        ),
      ...(options.items
        ? {
            item: z
              .string()
              .trim()
              .max(16)
              .nullish()
              .describe(
                'The id from <services> of the service or product this request is about (e.g. "s3"), when it is about one. Leave out otherwise; never guess.',
              ),
          }
        : {}),
      bestTime: z
        .string()
        .trim()
        .max(120)
        .nullish()
        .describe("When or how the visitor prefers to be contacted, if they said."),
      urgent: z
        .boolean()
        .optional()
        .describe(
          "true when the problem can't wait for a normal appointment (active leak or flooding, no heat in cold weather, no power, a vehicle broken down) or is a danger. The business is alerted at once.",
        ),
      ...(fields.length
        ? {
            details: z
              .object(
                Object.fromEntries(
                  fields.map((f) => [f.key, z.string().trim().max(200).optional().describe(f.hint)]),
                ),
              )
              .optional()
              .describe(
                "Details the business needs for this kind of request. Fill in each one the visitor gave in this conversation (for example the address or town they typed), in their own words. Leave out what they didn't say; never guess or infer it.",
              ),
          }
        : {}),
    }),

    async run(input, ctx) {
      const contact = readContact(input, ctx.visitorPhone, {
        missing:
          "A way to reach the visitor is missing. Ask for their email address or phone number, then call this again.",
        retry: ", then call this again",
      });
      if ("error" in contact) return { isError: true, content: contact.error };
      const { email, phone } = contact;

      return withTenant(ctx.db, ctx.tenantId, async (tx) => {
        const untyped = await untypedContact(tx, ctx.conversationId, contact);
        if (untyped) return { isError: true, content: untyped };

        // Urgent when the assistant says so, or when a message in this conversation was triaged so.
        const triaged =
          ctx.urgent ||
          (
            await tx
              .select({ flags: messages.flags })
              .from(messages)
              .where(and(eq(messages.conversationId, ctx.conversationId), eq(messages.role, "assistant")))
          ).some((m) => Boolean((m.flags as MessageFlags).urgency));
        const urgent = Boolean(input.urgent) || triaged;

        // The service or product the request is about: the one the assistant named, otherwise the
        // one whose quote or booking button was last shown in this conversation.
        const named = (input as { item?: string | null }).item?.trim();
        let item: { id: string; name: string } | null =
          (named && ctx.catalog?.find((c) => c.ref === named)) || null;
        const buttonKind = input.kind === "quote" ? "quote" : input.kind === "booking" ? "book" : null;
        if (!item && buttonKind) {
          const recent = await tx
            .select({ flags: messages.flags })
            .from(messages)
            .where(and(eq(messages.conversationId, ctx.conversationId), eq(messages.role, "assistant")))
            .orderBy(desc(messages.createdAt))
            .limit(6);
          const shown = recent
            .flatMap((m) => (m.flags as MessageFlags).actions ?? [])
            .find((a) => a.item && a.kind === buttonKind)?.item;
          // Still one of the business's items (it may have been removed since).
          item = (shown && ctx.catalog?.find((c) => c.id === shown.id)) || null;
        }

        // Only the industry's own fields, with what the visitor said.
        const given = (input as { details?: Record<string, string | undefined> }).details ?? {};
        const details: Record<string, string> = {};
        for (const field of fields) {
          const value = clean(given[field.key]);
          if (value) details[field.key] = value;
        }

        // The photos the visitor sent in this conversation (e.g. of the problem), newest first.
        const photos = await tx
          .select({ id: messageAttachments.id })
          .from(messageAttachments)
          .where(eq(messageAttachments.conversationId, ctx.conversationId))
          .orderBy(desc(messageAttachments.createdAt))
          .limit(MAX_REQUEST_PHOTOS);

        // The visitor adding or correcting details after their request was passed on: the request
        // the business already has is updated, so they don't get the same request twice. Only while
        // nobody has started on it or the team is waiting for the customer, and only for the same kind of follow-up (a complaint after a
        // quote request is its own request).
        const [latest] = await tx
          .select()
          .from(leads)
          .where(eq(leads.conversationId, ctx.conversationId))
          .orderBy(desc(leads.createdAt))
          .limit(1)
          .for("update");
        const waitingForCustomer = latest?.status !== "done" && latest?.nextAction?.waitingOn === "customer";
        if (
          latest &&
          (latest.status === "new" || waitingForCustomer) &&
          sameFollowUp(latest.kind, input.kind)
        ) {
          const becameUrgent = urgent && !latest.urgent;
          const [updated] = await tx
            .update(leads)
            .set({
              kind: input.kind,
              name: clean(input.name) ?? latest.name,
              email: email ?? latest.email,
              phone: phone ?? latest.phone,
              bestTime: clean(input.bestTime) ?? latest.bestTime,
              message: mergedRequest(latest.message, input.request),
              urgent: latest.urgent || urgent,
              details: { ...latest.details, ...details },
              catalogItemId: item?.id ?? latest.catalogItemId,
              itemName: item?.name ?? latest.itemName,
              attachmentIds: [...new Set([...latest.attachmentIds, ...photos.map((p) => p.id).reverse()])],
              contactId: await requestContact(tx, ctx, {
                name: clean(input.name) ?? latest.name,
                email: email ?? latest.email,
                phone: phone ?? latest.phone,
                current: latest.contactId,
              }),
              updatedAt: new Date(),
            })
            .where(eq(leads.id, latest.id))
            .returning();
          // The request now names a service it didn't before: counted for that service.
          if (item && !latest.catalogItemId) await countRequested(tx, ctx, item.id);
          // Keep the team's chosen step. A partial answer need not resolve what they asked for.
          if (
            waitingForCustomer &&
            !becameUrgent &&
            ctx.channel !== "playground" &&
            updated &&
            (updated.message !== latest.message ||
              updated.attachmentIds.length !== latest.attachmentIds.length ||
              updated.bestTime !== latest.bestTime ||
              updated.email !== latest.email ||
              updated.phone !== latest.phone ||
              Object.entries(details).some(([key, value]) => latest.details[key] !== value))
          ) {
            await tx.insert(jobs).values(
              newJob({
                tenantId: ctx.tenantId,
                type: JOB_TYPES.pushNotify,
                payload: {
                  event: "request.reply",
                  botId: ctx.botId,
                  leadId: latest.id,
                  actionVersion: latest.actionVersion,
                },
              }),
            );
          }
          return {
            content: becameUrgent
              ? "Added to the request already passed on, which is now marked urgent. The business is being alerted now. Still tell the visitor to call the business's phone number if they haven't."
              : "Added to the request already passed on: the business has the new details with it. Tell the visitor the details were added to their request; don't mention how many requests there are.",
            // Only an escalation repeats the urgent request effects.
            events: becameUrgent ? [requestEvent(updated!, fields, ctx.conversationId)] : [],
          };
        }

        const [{ sent } = { sent: 0 }] = await tx
          .select({ sent: count() })
          .from(leads)
          .where(eq(leads.conversationId, ctx.conversationId));
        if (sent >= MAX_REQUESTS_PER_CONVERSATION) {
          return {
            isError: true,
            content:
              "This conversation's requests were already passed on, and no more can be added. Tell the visitor the business has their details and will get back to them.",
          };
        }

        const [lead] = await tx
          .insert(leads)
          .values({
            tenantId: ctx.tenantId,
            botId: ctx.botId,
            conversationId: ctx.conversationId,
            channel: ctx.channel,
            kind: input.kind,
            name: clean(input.name) ?? input.name,
            email,
            phone,
            bestTime: clean(input.bestTime),
            message: input.request,
            language: ctx.language,
            urgent,
            details,
            catalogItemId: item?.id ?? null,
            itemName: item?.name ?? null,
            attachmentIds: photos.map((p) => p.id).reverse(),
            contactId: await requestContact(tx, ctx, { name: clean(input.name) ?? input.name, email, phone }),
          })
          .returning();

        if (item) await countRequested(tx, ctx, item.id);
        // One team reminder for an untouched request. A booked calendar visit uses its own tool.
        if (ctx.channel !== "playground") {
          await tx.insert(jobs).values(
            newJob({
              tenantId: ctx.tenantId,
              type: JOB_TYPES.pushNotify,
              runAt: new Date(lead!.createdAt.getTime() + 60 * 60_000),
              payload: { event: "request.reminder", botId: ctx.botId, leadId: lead!.id, unreviewed: true },
            }),
          );
        }
        return {
          content: urgent
            ? "Saved and marked urgent. The business is being alerted now. Still tell the visitor to call the business's phone number if they haven't."
            : "Saved. The business has been given this request and the visitor's contact details.",
          events: [requestEvent(lead!, fields, ctx.conversationId)],
        };
      });
    },
  });

/** The contact a request belongs to (Contacts in the owner app); none for the owner's own tests. */
export async function requestContact(
  tx: Tx,
  ctx: ToolContext,
  who: { name: string | null; email: string | null; phone: string | null; current?: string | null },
): Promise<string | null> {
  if (ctx.channel === "playground") return who.current ?? null;
  return contactFor(tx, ctx.tenantId, who, { current: who.current });
}

/** Statistics: a request about this service was passed on (not for the owner's own tests). */
export async function countRequested(tx: Tx, ctx: ToolContext, itemId: string) {
  const surface = itemStatSurface(ctx.channel);
  if (surface) {
    await countItemEvents(tx, {
      tenantId: ctx.tenantId,
      botId: ctx.botId,
      itemIds: [itemId],
      surface,
      event: "requested",
    });
  }
}

/** Kinds that are one follow-up seen from different sides: "call me" often turns out to be a quote or a booking. */
const FOLLOW_UP = new Set<string>(["callback", "quote", "booking"]);
const sameFollowUp = (a: string, b: string) => a === b || (FOLLOW_UP.has(a) && FOLLOW_UP.has(b));

/**
 * The request's text after an update: the new summary, unless it is much shorter than what the
 * business already has (then it only adds a detail, and is put after it).
 */
function mergedRequest(before: string, now: string): string {
  if (now.trim() === before.trim()) return before;
  if (now.length >= before.length * 0.6) return now;
  return `${before.trim()} ${now.trim()}`.slice(0, 1000);
}

/** What add-ons and alerts are told about a request. */
export function requestEvent(
  lead: typeof leads.$inferSelect,
  fields: LeadField[],
  conversationId: string,
): AddonEvent {
  return {
    type: "request.created",
    leadId: lead.id,
    conversationId,
    kind: lead.kind,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    bestTime: lead.bestTime,
    message: lead.message,
    language: lead.language,
    urgent: lead.urgent,
    item: lead.itemName,
    details: fields
      .filter((f) => lead.details[f.key])
      .map((f) => ({ key: f.key, label: f.label, value: lead.details[f.key]! })),
    photoCount: lead.attachmentIds.length,
    at: lead.createdAt,
  };
}
