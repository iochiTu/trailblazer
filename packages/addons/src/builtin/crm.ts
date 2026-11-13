import { z } from "zod";
import { defineAddon, type Localized } from "../types.js";

/**
 * CRM add-ons: each one hands the requests visitors leave (call back, quote, booking…) to the
 * software the business already runs on. The add-on only decides *which* requests go; the
 * connector with the same id in @traiblazer/integrations does the talking, with credentials the
 * owner connects in the portal (stored sealed, never in these settings).
 *
 * To add a CRM: write its connector, then add one `crmAddon({...})` entry below.
 */

const schema = z.object({
  /** "sales": only requests that can become a job (call back, quote, booking). */
  requests: z.enum(["all", "sales"]).default("all"),
});
export type CrmAddonConfig = z.infer<typeof schema>;

const SALES_KINDS = new Set(["callback", "quote", "booking"]);

const crmAddon = (input: {
  /** Add-on id and connector id (kept the same). */
  id: string;
  icon: string;
  name: Localized;
  summary: Localized;
  description: Localized;
}) =>
  defineAddon<CrmAddonConfig>({
    ...input,
    version: 1,
    category: "crm",
    status: "available",
    capabilities: ["crm"],
    integration: input.id,
    fields: [
      {
        key: "requests",
        type: "select",
        label: { en: "Requests to send", fr: "Demandes à envoyer" },
        hint: {
          en: "Requests left in your own test chat are never sent.",
          fr: "Les demandes laissées dans votre propre conversation d'essai ne sont jamais envoyées.",
        },
        options: [
          { value: "all", label: { en: "Every request", fr: "Toutes les demandes" } },
          {
            value: "sales",
            label: {
              en: "Call backs, quotes and bookings only",
              fr: "Rappels, soumissions et réservations seulement",
            },
          },
        ],
      },
    ],
    schema,
    defaults: { requests: "all" },

    onEvent(event, config) {
      if (event.type !== "request.created") return [];
      if (config.requests === "sales" && !SALES_KINDS.has(event.kind)) return [];
      return [{ kind: "crm.lead", provider: input.id, leadId: event.leadId }];
    },
  });

export const crmAddons = [
  crmAddon({
    id: "jobber",
    icon: "🧰",
    name: { en: "Jobber", fr: "Jobber" },
    summary: {
      en: "Send requests from your assistant straight into Jobber as new requests.",
      fr: "Envoyez les demandes de votre assistant directement dans Jobber comme nouvelles demandes.",
    },
    description: {
      en: "When a visitor asks for a quote, a booking or a call back, your assistant creates the request in Jobber with their contact details, what they need and a link back to the conversation. Existing clients are matched by email or phone; new ones are created for you.",
      fr: "Quand un visiteur demande une soumission, une réservation ou un rappel, votre assistant crée la demande dans Jobber avec ses coordonnées, son besoin et un lien vers la conversation. Les clients existants sont reconnus par courriel ou téléphone; les nouveaux sont créés pour vous.",
    },
  }),
  crmAddon({
    id: "housecall-pro",
    icon: "🏠",
    name: { en: "Housecall Pro", fr: "Housecall Pro" },
    summary: {
      en: "Send requests from your assistant to your Housecall Pro Job Inbox as leads.",
      fr: "Envoyez les demandes de votre assistant dans votre Job Inbox Housecall Pro comme prospects.",
    },
    description: {
      en: "Each request becomes a lead in Housecall Pro with the visitor's contact details and what they need. Existing customers are matched by email or phone. Needs the Housecall Pro MAX plan (API access).",
      fr: "Chaque demande devient un prospect dans Housecall Pro avec les coordonnées du visiteur et son besoin. Les clients existants sont reconnus par courriel ou téléphone. Nécessite le forfait MAX de Housecall Pro (accès API).",
    },
  }),
  crmAddon({
    id: "servicetitan",
    icon: "🛠️",
    name: { en: "ServiceTitan", fr: "ServiceTitan" },
    summary: {
      en: "Send requests from your assistant to ServiceTitan as bookings for your office to confirm.",
      fr: "Envoyez les demandes de votre assistant dans ServiceTitan comme réservations à confirmer par votre bureau.",
    },
    description: {
      en: "Each request appears on ServiceTitan's Bookings screen with the visitor's contact details and what they need, ready for your team to turn into a job.",
      fr: "Chaque demande apparaît à l'écran Bookings de ServiceTitan avec les coordonnées du visiteur et son besoin, prête à être transformée en travail par votre équipe.",
    },
  }),
  crmAddon({
    id: "webhook",
    icon: "🔗",
    name: { en: "Webhook (Zapier, Make, any CRM)", fr: "Webhook (Zapier, Make, tout CRM)" },
    summary: {
      en: "Send requests to HubSpot, Salesforce, Zoho, Pipedrive or any other tool through Zapier, Make or your own system.",
      fr: "Envoyez les demandes vers HubSpot, Salesforce, Zoho, Pipedrive ou tout autre outil par Zapier, Make ou votre propre système.",
    },
    description: {
      en: "Each request is posted to the address you give, as it happens. Use it with Zapier, Make, n8n or Power Automate to reach a CRM that has no add-on here yet, or with your own software.",
      fr: "Chaque demande est envoyée à l'adresse que vous donnez, au moment où elle arrive. Utilisez-le avec Zapier, Make, n8n ou Power Automate pour joindre un CRM qui n'a pas encore de module ici, ou avec votre propre logiciel.",
    },
  }),
];
