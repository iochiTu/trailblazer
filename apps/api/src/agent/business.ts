import { defineAgentTool, type Toolkit } from "@traiblazer/core";
import { businessProfiles, type WeeklyHours } from "@traiblazer/db";
import { businessProfileSchema } from "@traiblazer/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { inScope, json } from "./scope.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];
const DAY_NAMES: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** The details the agent may change (contact, links and page text; not the address or service area data). */
const DETAIL_FIELDS = [
  "businessName",
  "phone",
  "email",
  "websiteUrl",
  "description",
  "serviceArea",
  "credentials",
  "bookingUrl",
  "orderingUrl",
] as const;

const detailsInput = businessProfileSchema
  .pick(
    Object.fromEntries(DETAIL_FIELDS.map((f) => [f, true])) as {
      [K in (typeof DETAIL_FIELDS)[number]]: true;
    },
  )
  .refine((v) => Object.keys(v).length > 0, { message: "Give at least one detail to change" });

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)")
  .describe("24-hour time, HH:MM");
const dayHours = z
  .array(z.object({ open: time, close: time }))
  .max(4)
  .describe("The opening periods of the day, in order. An empty list means closed that day.");

const hoursInput = z.object({
  days: z
    .object(
      Object.fromEntries(DAYS.map((d) => [d, dayHours.optional()])) as Record<
        Day,
        z.ZodOptional<typeof dayHours>
      >,
    )
    .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Give at least one day" })
    .describe("Only the days that change; days left out keep their hours."),
});

const profileColumns = {
  businessName: businessProfiles.businessName,
  phone: businessProfiles.phone,
  email: businessProfiles.email,
  websiteUrl: businessProfiles.websiteUrl,
  address: businessProfiles.address,
  timezone: businessProfiles.timezone,
  hours: businessProfiles.hours,
  description: businessProfiles.description,
  serviceArea: businessProfiles.serviceArea,
  credentials: businessProfiles.credentials,
  bookingUrl: businessProfiles.bookingUrl,
  orderingUrl: businessProfiles.orderingUrl,
};

/** Hours as people read them: "Monday: 09:00–17:00", "Sunday: closed". */
export function describeHours(hours: WeeklyHours | null | undefined): Record<string, string> {
  return Object.fromEntries(
    DAYS.map((day) => {
      const slots = hours?.[day];
      return [DAY_NAMES[day], slots?.length ? slots.map((s) => `${s.open}–${s.close}`).join(", ") : "closed"];
    }),
  );
}

/** The business's details as the visitor chat and the page show them, and its weekly opening hours. */
export const businessToolkit: Toolkit = {
  id: "business",
  title: "Business details and opening hours",
  instructions: [
    "These are the details visitors see on the business page and that the assistant answers with.",
    "Read them with get_business_details before changing them, so you change only what the person asked.",
    "Hours are weekly and in the business's own time zone. For a one-off closure (a holiday, a vacation) don't change the weekly hours: add a notice instead, if you have the notices tools.",
    "Overnight hours (e.g. a bar open until 2 a.m.) are one period that closes after midnight: open 18:00, close 02:00.",
  ].join("\n"),
  tools: [
    defineAgentTool({
      name: "get_business_details",
      description:
        "The business's contact details, links, page description, service area, credentials, time zone and weekly opening hours.",
      input: z.object({}),
      effect: "read",
      run: async (_input, ctx) => {
        const profile = await inScope(ctx, async (tx) => {
          const [row] = await tx
            .select(profileColumns)
            .from(businessProfiles)
            .where(eq(businessProfiles.botId, ctx.botId))
            .limit(1);
          return row ?? null;
        });
        if (!profile) return { content: json({ details: null, note: "No details saved yet." }) };
        return { content: json({ ...profile, hours: describeHours(profile.hours) }) };
      },
    }),
    defineAgentTool({
      name: "update_business_details",
      description:
        "Change contact details, links or page text. Give only the fields that change; null removes a value. " +
        "description is one or two sentences for the top of the page (at most 300 characters).",
      input: detailsInput,
      effect: "write",
      run: async (input, ctx) => {
        const fields = Object.keys(input);
        const updated = await inScope(ctx, async (tx) => {
          const [row] = await tx
            .update(businessProfiles)
            .set(input)
            .where(eq(businessProfiles.botId, ctx.botId))
            .returning(profileColumns);
          if (!row) return null;
          await audit(tx, {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            action: "profile.updated",
            targetType: "bot",
            targetId: ctx.botId,
            metadata: { fields, via: "agent" },
          });
          return row;
        });
        if (!updated) return { isError: true, content: "This assistant has no business details to change." };
        return {
          content: json({ saved: fields, details: { ...updated, hours: describeHours(updated.hours) } }),
          changes: [{ area: "business", summary: `Business details updated: ${fields.join(", ")}` }],
        };
      },
    }),
    defineAgentTool({
      name: "set_opening_hours",
      description:
        "Change the weekly opening hours of some days. Give each changed day's full list of periods " +
        '(e.g. {"sat": [{"open": "10:00", "close": "14:00"}]}); an empty list closes that day. Other days stay as they are.',
      input: hoursInput,
      effect: "write",
      run: async ({ days }, ctx) => {
        const changed = DAYS.filter((d) => days[d] !== undefined);
        const hours = await inScope(ctx, async (tx) => {
          const [row] = await tx
            .select({ hours: businessProfiles.hours })
            .from(businessProfiles)
            .where(eq(businessProfiles.botId, ctx.botId))
            .limit(1);
          if (!row) return null;
          const next: WeeklyHours = { ...(row.hours ?? {}) };
          for (const day of changed) next[day] = days[day]!;
          await tx.update(businessProfiles).set({ hours: next }).where(eq(businessProfiles.botId, ctx.botId));
          await audit(tx, {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            action: "profile.hours_updated",
            targetType: "bot",
            targetId: ctx.botId,
            metadata: { days: changed, via: "agent" },
          });
          return next;
        });
        if (!hours) return { isError: true, content: "This assistant has no business details to change." };
        return {
          content: json({ saved: changed.map((d) => DAY_NAMES[d]), hours: describeHours(hours) }),
          changes: [
            {
              area: "business",
              summary: `Opening hours updated: ${changed.map((d) => DAY_NAMES[d]).join(", ")}`,
            },
          ],
        };
      },
    }),
  ],
};
