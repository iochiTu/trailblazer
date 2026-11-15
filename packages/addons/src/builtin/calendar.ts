import { z } from "zod";
import { defineAddon } from "../types.js";

/**
 * Calendar booking: the assistant offers real open times (the business's opening hours, minus what
 * its calendar says is busy) and books the one the visitor picks, as an appointment in the calendar
 * and a booking request for staff. The connector with the same id in @traiblazer/integrations talks
 * to the calendar; the tools that do the booking are in @traiblazer/core (chat/tools/booking.ts),
 * given to the assistant only while this add-on is on and the calendar is connected.
 */

const schema = z.object({
  /** How long one appointment takes, in minutes. */
  duration: z.enum(["30", "45", "60", "90", "120"]).default("60"),
  /** How soon the earliest appointment can be, in hours from now. */
  notice: z.enum(["1", "4", "24", "48"]).default("24"),
  /** How far ahead visitors can book, in days. */
  daysAhead: z.enum(["7", "14", "30", "60"]).default("14"),
});
export type CalendarAddonConfig = z.infer<typeof schema>;

/** The settings as numbers, for the booking tools. */
export const bookingSettings = (config: CalendarAddonConfig) => ({
  durationMinutes: Number(config.duration),
  noticeMinutes: Number(config.notice) * 60,
  daysAhead: Number(config.daysAhead),
});

export const googleCalendarAddon = defineAddon<CalendarAddonConfig>({
  id: "google-calendar",
  version: 1,
  category: "booking",
  status: "available",
  icon: "📅",
  name: { en: "Google Calendar booking", fr: "Réservation Google Agenda" },
  summary: {
    en: "Your assistant offers real open times and books appointments in your Google Calendar.",
    fr: "Votre assistant propose de vraies disponibilités et réserve les rendez-vous dans votre Google Agenda.",
  },
  description: {
    en: "Visitors pick a time that suits them within your opening hours, and your assistant books it in your Google Calendar with their name, contact details and what they need. Times already taken in your calendar are never offered. Each booking also shows in your requests, so you can confirm it with the customer. Your assistant only sees when you're busy, never what is in your calendar.",
    fr: "Les visiteurs choisissent une heure qui leur convient pendant vos heures d'ouverture, et votre assistant la réserve dans votre Google Agenda avec leur nom, leurs coordonnées et leur besoin. Les heures déjà prises dans votre agenda ne sont jamais proposées. Chaque réservation apparaît aussi dans vos demandes, pour que vous la confirmiez avec le client. Votre assistant voit seulement quand vous êtes occupé, jamais le contenu de votre agenda.",
  },
  capabilities: ["booking", "prompt"],
  integration: "google-calendar",
  fields: [
    {
      key: "duration",
      type: "select",
      label: { en: "Length of an appointment", fr: "Durée d'un rendez-vous" },
      options: ["30", "45", "60", "90", "120"].map((m) => ({
        value: m,
        label:
          Number(m) < 60 || Number(m) % 60
            ? { en: `${m} minutes`, fr: `${m} minutes` }
            : { en: Number(m) === 60 ? "1 hour" : `${Number(m) / 60} hours`, fr: `${Number(m) / 60} h` },
      })),
    },
    {
      key: "notice",
      type: "select",
      label: { en: "Earliest booking", fr: "Réservation au plus tôt" },
      hint: {
        en: "Visitors can't book a time sooner than this. Urgent problems are passed to you right away instead.",
        fr: "Les visiteurs ne peuvent pas réserver plus tôt que ce délai. Les problèmes urgents vous sont transmis tout de suite.",
      },
      options: [
        { value: "1", label: { en: "1 hour from now", fr: "Dans 1 heure" } },
        { value: "4", label: { en: "4 hours from now", fr: "Dans 4 heures" } },
        { value: "24", label: { en: "1 day from now", fr: "Dans 1 jour" } },
        { value: "48", label: { en: "2 days from now", fr: "Dans 2 jours" } },
      ],
    },
    {
      key: "daysAhead",
      type: "select",
      label: { en: "How far ahead", fr: "Jusqu'à quand" },
      hint: {
        en: "Times are offered within your opening hours (Business page tab).",
        fr: "Les heures proposées respectent vos heures d'ouverture (onglet Page d'entreprise).",
      },
      options: [
        { value: "7", label: { en: "1 week", fr: "1 semaine" } },
        { value: "14", label: { en: "2 weeks", fr: "2 semaines" } },
        { value: "30", label: { en: "1 month", fr: "1 mois" } },
        { value: "60", label: { en: "2 months", fr: "2 mois" } },
      ],
    },
  ],
  schema,
  defaults: { duration: "60", notice: "24", daysAhead: "14" },

  prompt(config) {
    const { durationMinutes } = bookingSettings(config);
    return `Booking appointments: you can book ${durationMinutes}-minute appointments in the business's calendar.
- When a visitor wants an appointment, a visit or a time, call find_open_times and offer two to four of the times it gives, in the visitor's language. Never offer or book a time it didn't give.
- Once the visitor picked a time and gave their name and a phone number or email, call book_appointment. Say the time is booked only after it succeeded, and say the business may contact them to confirm.
- If no time suits them, or booking fails, offer to pass their request on (request_follow_up) instead.
- An urgent problem is not booked: follow the urgent instructions (call now, request marked urgent).`;
  },
});
