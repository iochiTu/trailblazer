import { randomUUID } from "node:crypto";
import { bookings, leads, messageAttachments, tenants, withTenant } from "@traiblazer/db";
import { enOrFr } from "@traiblazer/i18n";
import type { LeadField } from "@traiblazer/industry-packs";
import { ConnectorError } from "@traiblazer/integrations";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
  addDays,
  isoDate,
  localDate,
  localTimeId,
  openTimes,
  type PartOfDay,
  parseLocalTime,
  partOfDay,
  pickTimes,
  searchWindow,
} from "../../booking/slots.js";
import type { CalendarAccess } from "../../integrations/calendar.js";
import { clean, readContact, untypedContact } from "./contact.js";
import { type AnyChatTool, defineTool } from "./contract.js";
import {
  countRequested,
  MAX_REQUEST_PHOTOS,
  MAX_REQUESTS_PER_CONVERSATION,
  requestContact,
  requestEvent,
} from "./follow-up.js";

/**
 * Booking in the business's calendar (the Google Calendar add-on): one tool finds open times, the
 * other books the one the visitor picked. The open times are worked out on the server from the
 * business's opening hours and its calendar's busy times; a booking is checked against them again,
 * so the model can't book a time it made up or one that was taken in the meantime.
 *
 * A booking makes three things: the appointment in the calendar, a "booking" request (so staff see
 * it with the other requests, and the email and CRM add-ons send it on), and a `bookings` row tying
 * them together. Nothing is written to the calendar from the owner's own test chat.
 */

/** Most times offered at once (the model offers a few of them). */
const MAX_OFFERED = 8;

const CALENDAR_DOWN =
  "The calendar can't be reached right now. Don't offer times. Offer to pass the visitor's request on with request_follow_up so the business books it, or give the business's phone number.";

const formatter = (language: string, timeZone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(language, { timeZone, ...options });

/** "Tuesday, November 17, 10:00": how a time is shown to the model (it says it in the visitor's language). */
const forModel = (instant: Date, timeZone: string) =>
  formatter("en-CA", timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);

/** "mardi 17 novembre, 10 h 00 – 11 h 00": the booked time on the request, in the owner's language. */
export function bookedLabel(start: Date, end: Date, timeZone: string, language: "en" | "fr") {
  const locale = language === "fr" ? "fr-CA" : "en-CA";
  const day = formatter(locale, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const time = formatter(locale, timeZone, { hour: "numeric", minute: "2-digit" });
  return `${day.format(start)}, ${time.format(start)} – ${time.format(end)}`;
}

const dateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe(
    'First day to look at, as YYYY-MM-DD in the business\'s time zone (use the local date in the instructions to work out "Thursday" or "next week"). Leave out to start from the earliest open time.',
  );

export const findOpenTimesTool = (calendar: CalendarAccess) =>
  defineTool({
    name: "find_open_times",
    description: `Find times the business can take an appointment (${calendar.durationMinutes} minutes), from its opening hours and its calendar. Use it when a visitor wants to book, asks when the business can come or see them, or asks about availability. It gives up to ${MAX_OFFERED} times; offer the visitor two to four of them, in their language. Times not in its answer can't be booked.`,
    input: z.object({
      from: dateInput,
      partOfDay: z
        .enum(["morning", "afternoon", "evening"])
        .optional()
        .describe(
          "Only times in this part of the day (before noon, noon to 5 pm, after 5 pm), if the visitor asked.",
        ),
    }),

    async run(input, ctx) {
      if (!calendar.hours || !Object.values(calendar.hours).some((day) => day?.length)) {
        return {
          isError: true,
          content:
            "The business hasn't set its opening hours, so no times can be offered. Offer to pass the visitor's request on with request_follow_up instead.",
        };
      }
      const now = ctx.now?.() ?? new Date();
      const from = input.from ? parseLocalTime(`${input.from}T00:00`)?.date : undefined;
      if (input.from && !from)
        return { isError: true, content: `"${input.from}" isn't a date. Use YYYY-MM-DD.` };
      const lastDay = addDays(localDate(now, calendar.timeZone), calendar.daysAhead);
      if (from && isoDate(from) > isoDate(lastDay)) {
        return {
          content: `Appointments can only be booked up to ${isoDate(lastDay)}. Tell the visitor, and offer to pass their request on with request_follow_up.`,
        };
      }

      // Look a week at a time from the first day asked about.
      const window = { ...calendar, now, from, days: 7 };
      const range = searchWindow(window);
      let times: Date[] = [];
      if (range) {
        let busy: Awaited<ReturnType<CalendarAccess["busyTimes"]>>;
        try {
          busy = await calendar.busyTimes({ from: range.start, to: range.end });
        } catch (error) {
          if (error instanceof ConnectorError) return { isError: true, content: CALENDAR_DOWN };
          throw error;
        }
        times = openTimes({ ...window, hours: calendar.hours, busy });
      }
      if (input.partOfDay) {
        const wanted: PartOfDay = input.partOfDay;
        times = times.filter((t) => partOfDay(t, calendar.timeZone) === wanted);
      }
      if (!times.length) {
        // The calendar was asked up to midnight after the last day: the next day to look from.
        const next = range ? isoDate(localDate(range.end, calendar.timeZone)) : null;
        return {
          content: `No open times ${input.partOfDay ? `in the ${input.partOfDay} ` : ""}in the 7 days from ${isoDate(from ?? localDate(now, calendar.timeZone))}.${next && next <= isoDate(lastDay) ? ` You can look again from ${next}.` : ""} Or offer to pass the visitor's request on with request_follow_up.`,
        };
      }
      const offered = pickTimes(times, calendar.timeZone, { perDay: 3, max: MAX_OFFERED });
      const lines = offered.map(
        (t) => `- ${localTimeId(t, calendar.timeZone)} (${forModel(t, calendar.timeZone)})`,
      );
      return {
        content: `Open times (${calendar.timeZone}, ${calendar.durationMinutes} minutes each). Book with the value before the brackets, exactly as written:\n${lines.join("\n")}\nOther times between these may also be open: if the visitor asks for one, call book_appointment with it and it will be checked.`,
      };
    },
  });

export const bookAppointmentTool = (
  calendar: CalendarAccess,
  fields: LeadField[],
  options: { items?: boolean } = {},
) =>
  defineTool({
    name: "book_appointment",
    description: `Book an appointment in the business's calendar at a time from find_open_times, once the visitor chose it. Before calling it you need the visitor's name, a phone number or email address they typed in this conversation, and what the appointment is for. It puts the appointment in the calendar and passes the booking to staff with the visitor's details. Only one appointment per conversation: to change or cancel it, pass the visitor's request on with request_follow_up.`,
    input: z.object({
      start: z
        .string()
        .trim()
        .max(20)
        .describe('The chosen start time exactly as find_open_times gave it, e.g. "2026-11-17T10:00".'),
      name: z.string().trim().min(1).max(120).describe("The visitor's name, as they gave it."),
      email: z
        .string()
        .trim()
        .max(254)
        .nullish()
        .describe("The visitor's email address, exactly as they typed it."),
      phone: z.string().trim().max(40).nullish().describe("The visitor's phone number, as they typed it."),
      request: z
        .string()
        .trim()
        .min(3)
        .max(1000)
        .describe(
          "What the appointment is for, in one to three sentences for the business's staff. Leave out health, legal, financial or other sensitive details; name only the general topic.",
        ),
      ...(options.items
        ? {
            item: z
              .string()
              .trim()
              .max(16)
              .nullish()
              .describe('The id from <services> of the service it is for (e.g. "s3"), if any. Never guess.'),
          }
        : {}),
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
                "Details the business needs, each one the visitor gave in this conversation, in their own words. Never guess.",
              ),
          }
        : {}),
    }),

    async run(input, ctx) {
      // The visitor's contact details, checked as for any request (see request_follow_up).
      const contact = readContact(input, ctx.visitorPhone, {
        missing: "A way to reach the visitor is missing. Ask for their phone number or email address first.",
        retry: "",
      });
      if ("error" in contact) return { isError: true, content: contact.error };
      const { email, phone } = contact;

      const when = parseLocalTime(input.start);
      if (!when) {
        return {
          isError: true,
          content: `"${input.start}" isn't a time from find_open_times. Call find_open_times and use one of its times exactly.`,
        };
      }

      const checked = await withTenant(ctx.db, ctx.tenantId, async (tx) => {
        const untyped = await untypedContact(tx, ctx.conversationId, contact);
        if (untyped) return untyped;
        const [earlier] = await tx
          .select({ startsAt: bookings.startsAt })
          .from(bookings)
          .where(and(eq(bookings.conversationId, ctx.conversationId), ne(bookings.status, "failed")))
          .limit(1);
        if (earlier) {
          return `An appointment was already booked in this conversation (${forModel(earlier.startsAt, calendar.timeZone)}). Only one can be booked per conversation: to change or cancel it, pass the visitor's request on with request_follow_up.`;
        }
        const [{ sent } = { sent: 0 }] = await tx
          .select({ sent: count() })
          .from(leads)
          .where(eq(leads.conversationId, ctx.conversationId));
        if (sent >= MAX_REQUESTS_PER_CONVERSATION) {
          return "This conversation's requests were already passed on, and no more can be added. Tell the visitor the business has their details and will get back to them.";
        }
        return null;
      });
      if (checked) return { isError: true, content: checked };

      // The time must still be open: the business's hours, the notice, and the calendar right now.
      const now = ctx.now?.() ?? new Date();
      const day = { ...calendar, hours: calendar.hours ?? {}, now, from: when.date, days: 1 };
      const range = searchWindow(day);
      let start: Date | undefined;
      try {
        const busy = range ? await calendar.busyTimes({ from: range.start, to: range.end }) : [];
        start = openTimes({ ...day, busy }).find(
          (t) => localTimeId(t, calendar.timeZone) === input.start.replace(" ", "T"),
        );
      } catch (error) {
        if (error instanceof ConnectorError) return { isError: true, content: CALENDAR_DOWN };
        throw error;
      }
      if (!start) {
        return {
          isError: true,
          content: `${input.start} isn't open (outside the hours, too soon, or taken). Call find_open_times again and offer the visitor other times.`,
        };
      }
      const end = new Date(start.getTime() + calendar.durationMinutes * 60_000);
      const shown = forModel(start, calendar.timeZone);

      if (ctx.channel === "playground") {
        return {
          content: `Test chat: ${shown} is open, and a visitor would now be booked. Nothing was put in the calendar or saved as a request. Tell the tester it would be booked for ${shown}.`,
        };
      }

      // Holds the time first: a second visitor booking the same start at once is refused here.
      const bookingId = randomUUID();
      const held = await withTenant(ctx.db, ctx.tenantId, (tx) =>
        tx
          .insert(bookings)
          .values({
            id: bookingId,
            tenantId: ctx.tenantId,
            botId: ctx.botId,
            conversationId: ctx.conversationId,
            provider: calendar.provider,
            startsAt: start,
            endsAt: end,
            timeZone: calendar.timeZone,
          })
          .onConflictDoNothing()
          .returning({ id: bookings.id }),
      );
      if (!held.length) {
        return {
          isError: true,
          content: `${input.start} was just taken. Call find_open_times again and offer the visitor other times.`,
        };
      }

      const [{ ownerLanguage } = { ownerLanguage: null }] = await withTenant(ctx.db, ctx.tenantId, (tx) =>
        tx
          .select({ ownerLanguage: tenants.ownerLanguage })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .limit(1),
      );
      const label = bookedLabel(start, end, calendar.timeZone, enOrFr(ownerLanguage));
      const name = clean(input.name) ?? input.name;
      const given = (input as { details?: Record<string, string | undefined> }).details ?? {};
      const details: Record<string, string> = {};
      for (const field of fields) {
        const value = clean(given[field.key]);
        if (value) details[field.key] = value;
      }

      let made: { externalId: string | null; externalUrl: string | null };
      try {
        made = await calendar.createEvent({
          id: bookingId,
          start,
          end,
          timeZone: calendar.timeZone,
          title: `${name}: ${input.request}`.slice(0, 120),
          description: [
            input.request,
            "",
            phone ? `📞 ${phone}` : null,
            email ? `✉️ ${email}` : null,
            ...fields.filter((f) => details[f.key]).map((f) => `${f.label.en}: ${details[f.key]}`),
            "",
            "Booked by your assistant. Please confirm with the customer.",
          ]
            .filter((line) => line !== null)
            .join("\n"),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await withTenant(ctx.db, ctx.tenantId, (tx) =>
          tx
            .update(bookings)
            .set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() })
            .where(eq(bookings.id, bookingId)),
        );
        if (error instanceof ConnectorError) {
          return {
            isError: true,
            content:
              "The calendar refused the booking. Nothing was booked. Offer to pass the visitor's request on with request_follow_up, or give the business's phone number.",
          };
        }
        throw error;
      }

      return withTenant(ctx.db, ctx.tenantId, async (tx) => {
        const named = (input as { item?: string | null }).item?.trim();
        const item = (named && ctx.catalog?.find((c) => c.ref === named)) || null;
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
            kind: "booking",
            name,
            email,
            phone,
            bestTime: label,
            message: input.request,
            language: ctx.language,
            urgent: false,
            details,
            catalogItemId: item?.id ?? null,
            itemName: item?.name ?? null,
            attachmentIds: photos.map((p) => p.id).reverse(),
            contactId: await requestContact(tx, ctx, { name, email, phone }),
          })
          .returning();
        await tx
          .update(bookings)
          .set({
            status: "booked",
            leadId: lead!.id,
            externalId: made.externalId,
            externalUrl: made.externalUrl,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, bookingId));
        if (item) await countRequested(tx, ctx, item.id);
        return {
          content: `Booked for ${shown} (${calendar.durationMinutes} minutes). The appointment is in the business's calendar and staff have the visitor's details. Tell the visitor it is booked for that time and the business may contact them to confirm.`,
          events: [requestEvent(lead!, fields, ctx.conversationId)],
        };
      });
    },
  });

/** Both booking tools, for an assistant whose calendar is connected. */
export const bookingTools = (
  calendar: CalendarAccess,
  fields: LeadField[],
  options: { items?: boolean } = {},
): AnyChatTool[] => [findOpenTimesTool(calendar), bookAppointmentTool(calendar, fields, options)];
