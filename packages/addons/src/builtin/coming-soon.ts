import { z } from "zod";
import { type AddonCapability, type AddonCategory, defineAddon, type Localized } from "../types.js";

/** Listed in the market so owners see what's next (and we can gauge interest); not installable yet. */
const comingSoon = (input: {
  id: string;
  category: AddonCategory;
  icon: string;
  name: Localized;
  summary: Localized;
  capabilities: AddonCapability[];
}) =>
  defineAddon({
    ...input,
    version: 1,
    status: "coming_soon",
    description: input.summary,
    fields: [],
    schema: z.object({}),
    defaults: {},
  });

export const comingSoonAddons = [
  comingSoon({
    id: "catalog-sync",
    category: "commerce",
    icon: "📦",
    name: { en: "Product catalog sync", fr: "Synchronisation du catalogue" },
    summary: {
      en: "Answer questions about your products, prices and stock from Shopify, Square or WooCommerce.",
      fr: "Répondez aux questions sur vos produits, prix et stocks depuis Shopify, Square ou WooCommerce.",
    },
    capabilities: ["prompt"],
  }),
  comingSoon({
    id: "booking-calendar",
    category: "booking",
    icon: "📅",
    name: { en: "Booking calendar", fr: "Calendrier de réservation" },
    summary: {
      en: "Show real open times from Calendly, Square Appointments or Google Calendar.",
      fr: "Affichez les vraies disponibilités de Calendly, Square Rendez-vous ou Google Agenda.",
    },
    capabilities: ["prompt", "chat_links"],
  }),
  comingSoon({
    id: "sms-alerts",
    category: "notifications",
    icon: "💬",
    name: { en: "Text message alerts", fr: "Alertes par texto" },
    summary: {
      en: "Get a text message when a visitor asks to be called back.",
      fr: "Recevez un texto quand un visiteur demande d'être rappelé.",
    },
    capabilities: ["notifications"],
  }),
  comingSoon({
    id: "google-sheets",
    category: "productivity",
    icon: "📊",
    name: { en: "Google Sheets", fr: "Google Sheets" },
    summary: {
      en: "Save visitor requests and contact details to a spreadsheet automatically.",
      fr: "Enregistrez automatiquement les demandes et coordonnées des visiteurs dans un tableur.",
    },
    capabilities: ["notifications"],
  }),
];
