import {
  leadKinds,
  leads,
  type MessageFlags,
  messageAttachments,
  messages,
  withTenant,
} from "@traiblazer/db";
import type { LeadField } from "@traiblazer/industry-packs";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { defineTool } from "./contract.js";

/** Most requests one conversation can leave (a visitor correcting a detail, not a flood). */
export const MAX_REQUESTS_PER_CONVERSATION = 3;
/** Most of the visitor's photos attached to one request (the newest). */
export const MAX_REQUEST_PHOTOS = 6;

const emailSchema = z.email().max(254);
const digits = (text: string) => text.replace(/\D/g, "");
/**
 * What models write in a field they have nothing for ("null", "N/A", "none", "aucun"…), instead
 * of leaving it out. Compared lower case, without accents or a final full stop.
 */
const PLACEHOLDERS = new Set([
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "nil",
  "unknown",
  "not provided",
  "not given",
  "not specified",
  "-",
  "--",
  "?",
  "aucun",
  "aucune",
  "non fourni",
  "non precise",
  "inconnu",
  "s.o",
  "sans objet",
]);

/** The value with spaces tidied; null when empty or a placeholder for "nothing". */
const clean = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const key = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  return PLACEHOLDERS.has(key) ? null : text;
};

/**
 * True when the visitor typed this contact detail themselves in the conversation. Contact details
 * are personal data a business will act on, so the assistant can pass on only what the visitor
 * wrote: never a guess, and never an address or number picked up from the business's own pages.
 */
function typedByVisitor(detail: { email?: string | null; phone?: string | null }, visitorText: string[]) {
  if (detail.email) {
    const email = detail.email.toLowerCase();
    return visitorText.some((text) => text.toLowerCase().includes(email));
  }
  const number = digits(detail.phone ?? "");
  // A country code the visitor left out ("+1") is fine: the last ten digits must be theirs.
  const local = number.length > 10 ? number.slice(-10) : number;
  return visitorText.some((text) => digits(text).includes(local));
}

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
      // Without an "@" or a digit it isn't an attempt at an address or number: treat as not given.
      const rawEmail = clean(input.email);
      const email = rawEmail?.includes("@") ? rawEmail.toLowerCase() : null;
      const rawPhone = clean(input.phone);
      // By text message, the number the customer writes from stands in when they gave no other.
      const phone = rawPhone && /\d/.test(rawPhone) ? rawPhone : (ctx.visitorPhone ?? null);
      const ownNumber = Boolean(
        phone && ctx.visitorPhone && digits(ctx.visitorPhone).endsWith(digits(phone).slice(-10)),
      );
      if (!email && !phone) {
        return {
          isError: true,
          content:
            "A way to reach the visitor is missing. Ask for their email address or phone number, then call this again.",
        };
      }
      if (email && !emailSchema.safeParse(email).success) {
        return {
          isError: true,
          content: `"${email}" isn't a complete email address. Ask the visitor to check it, then call this again.`,
        };
      }
      if (phone && digits(phone).length < 7) {
        return {
          isError: true,
          content: `"${phone}" isn't a complete phone number. Ask the visitor to check it, then call this again.`,
        };
      }

      return withTenant(ctx.db, ctx.tenantId, async (tx) => {
        const visitorText = (
          await tx
            .select({ content: messages.content })
            .from(messages)
            .where(and(eq(messages.conversationId, ctx.conversationId), eq(messages.role, "user")))
        ).map((m) => m.content);
        for (const detail of [email && { email }, phone && !ownNumber && { phone }]) {
          if (detail && !typedByVisitor(detail, visitorText)) {
            const value = "email" in detail ? detail.email : detail.phone;
            return {
              isError: true,
              content: `The visitor didn't type "${value}" in this conversation. Ask them for their ${"email" in detail ? "email address" : "phone number"} and use exactly what they write.`,
            };
          }
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
          })
          .returning();

        return {
          content: urgent
            ? "Saved and marked urgent. The business is being alerted now. Still tell the visitor to call the business's phone number if they haven't."
            : "Saved. The business has been given this request and the visitor's contact details.",
          events: [
            {
              type: "request.created",
              leadId: lead!.id,
              conversationId: ctx.conversationId,
              kind: lead!.kind,
              name: lead!.name,
              email: lead!.email,
              phone: lead!.phone,
              bestTime: lead!.bestTime,
              message: lead!.message,
              language: lead!.language,
              urgent: lead!.urgent,
              item: lead!.itemName,
              details: fields
                .filter((f) => details[f.key])
                .map((f) => ({ key: f.key, label: f.label, value: details[f.key]! })),
              photoCount: lead!.attachmentIds.length,
              at: lead!.createdAt,
            },
          ],
        };
      });
    },
  });

/** The request tool without industry fields (generic businesses, tests). */
export const requestFollowUp = requestFollowUpTool([]);
