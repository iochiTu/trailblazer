import type { Lang, Localized } from "./site.js";

/**
 * What the product is, said once. The pages, llms.txt and the MCP server all read these lines, so
 * the description can't drift between them. Keep every line true of what is built today (see the
 * README); planned features don't belong here.
 */

export const TAGLINE: Localized = {
  en: "An AI assistant and business page for small local businesses",
  fr: "Un assistant IA et une page d'entreprise pour les petites entreprises locales",
};

export const SUMMARY: Localized = {
  en: "Traiblazer gives a small local business a public page that shows its services, prices, hours and service area, with an AI assistant on it that answers customers' questions from the business's own information, in English, French and other languages, and takes their requests when the owner is busy.",
  fr: "Traiblazer donne à une petite entreprise locale une page publique qui présente ses services, ses prix, ses heures et son secteur, avec un assistant IA qui répond aux questions des clients à partir des renseignements de l'entreprise, en français, en anglais et dans d'autres langues, et qui prend leurs demandes quand le propriétaire est occupé.",
};

export const WHO_FOR: Localized = {
  en: "Small local businesses in Canada: trades and home services, auto repair and tire shops, restaurants, cafés and bakeries, retail stores, salons and spas, lodging and attractions. It is made for owners who don't have time for a website project.",
  fr: "Les petites entreprises locales au Canada : métiers et services à domicile, ateliers mécaniques et centres de pneus, restaurants, cafés et boulangeries, commerces de détail, salons et spas, hébergement et attraits. Il est conçu pour les propriétaires qui n'ont pas le temps de se lancer dans un projet de site Web.",
};

export const SERVICE_AREA: Localized = {
  en: "Traiblazer is online software: a business signs up and sets it up on the web, so it isn't tied to one city. It is made for Canadian businesses, in English and French, with prices in Canadian dollars, and has local pages for cities in Northern Ontario.",
  fr: "Traiblazer est un logiciel en ligne : l'entreprise s'inscrit et le configure sur le Web, sans être liée à une ville. Il est conçu pour les entreprises canadiennes, en français et en anglais, avec des prix en dollars canadiens, et propose des pages locales pour des villes du Nord de l'Ontario.",
};

export interface Feature {
  title: Localized;
  body: Localized;
}

export const FEATURES: Feature[] = [
  {
    title: {
      en: "A business page without a website project",
      fr: "Une page d'entreprise sans projet de site Web",
    },
    body: {
      en: "Services and products with prices, notices, photos, opening hours, service area and Call, Book, Email and Directions buttons. It reads well without chatting, works on any phone, and search engines can read it.",
      fr: "Services et produits avec prix, avis, photos, heures d'ouverture, secteur desservi et boutons Appeler, Réserver, Courriel et Itinéraire. Elle se lit sans clavarder, s'affiche bien sur tout téléphone et les moteurs de recherche peuvent la lire.",
    },
  },
  {
    title: {
      en: "Answers only from your information",
      fr: "Des réponses tirées uniquement de vos renseignements",
    },
    body: {
      en: "The assistant answers from what you gave it: your website, price lists, brochures, notes and a short interview. It doesn't invent prices, stock or availability, and says so when it doesn't know.",
      fr: "L'assistant répond à partir de ce que vous lui avez fourni : votre site Web, vos listes de prix, vos dépliants, vos notes et une courte entrevue. Il n'invente ni prix, ni stock, ni disponibilité, et le dit quand il ne sait pas.",
    },
  },
  {
    title: { en: "English, French and more", fr: "Français, anglais et plus" },
    body: {
      en: "The owner's portal is in English and French. The assistant answers each visitor in the language they write in.",
      fr: "Le portail du propriétaire est en français et en anglais. L'assistant répond à chaque visiteur dans la langue qu'il utilise.",
    },
  },
  {
    title: { en: "Requests you can act on", fr: "Des demandes prêtes à traiter" },
    body: {
      en: "Visitors leave quote, repair and booking requests with the details and photos you need. Urgent problems are flagged, the service area is checked, and you can be notified by email.",
      fr: "Les visiteurs laissent des demandes de soumission, de réparation et de rendez-vous avec les détails et les photos nécessaires. Les urgences sont signalées, le secteur desservi est vérifié et vous pouvez être avisé par courriel.",
    },
  },
  {
    title: { en: "Share it anywhere", fr: "À partager partout" },
    body: {
      en: "One link for your Google listing, a QR code for the truck or the counter, or the chat placed on a website you already have.",
      fr: "Un seul lien pour votre fiche Google, un code QR pour le camion ou le comptoir, ou le clavardage intégré à un site Web que vous avez déjà.",
    },
  },
];

export const GET_STARTED: Localized = {
  en: "Start the free trial: create an account, add your business information and test the assistant before customers see it. No sales call is needed.",
  fr: "Commencez l'essai gratuit : créez un compte, ajoutez les renseignements de votre entreprise et testez l'assistant avant que les clients le voient. Aucun appel de vente n'est nécessaire.",
};

export const PRICE_NOTE: Localized = {
  en: "Prices are in Canadian dollars per month, before taxes.",
  fr: "Les prix sont en dollars canadiens par mois, avant taxes.",
};

export const PLANS_INCLUDE: Localized = {
  en: "Every plan includes the business page, the assistant in every language and all features.",
  fr: "Chaque forfait comprend la page d'entreprise, l'assistant dans toutes les langues et toutes les fonctions.",
};

export const pick = <T>(value: Record<Lang, T>, lang: Lang): T => value[lang];
