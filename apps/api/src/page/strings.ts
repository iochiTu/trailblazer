/**
 * Business page text, in English and French (Tier 1). The page is rendered in the assistant's
 * default language when it is one of these, otherwise in English; the chat on it still answers
 * in the visitor's language.
 */
const en = {
  call: "Call",
  phone: "Phone",
  email: "Email",
  directions: "Directions",
  book: "Book",
  website: "Website",
  shop: "Shop online",
  link: "Open link",
  openNow: "Open now",
  closedNow: "Closed now",
  closesAt: "closes at {time}",
  opensAt: "opens {day} at {time}",
  opensTodayAt: "opens today at {time}",
  services: "Services",
  products: "Products",
  servicesAndProducts: "Services & products",
  photos: "Photos",
  hours: "Opening hours",
  closed: "Closed",
  serviceArea: "Service area",
  areasServed: "Areas served",
  credentials: "Licences & insurance",
  languages: "Languages spoken",
  address: "Address",
  contact: "Contact",
  notice: "Notice",
  chatHeading: "Ask us anything",
  chatHeadingPersonal: "Ask me anything",
  noScript: "Turn on JavaScript to chat with the assistant, or contact us directly.",
  askAbout: "Ask about this",
  requestQuote: "Request a quote",
  askMessage: "Tell me about {item}.",
  quoteMessage: "I'd like a quote for {item}.",
  bookMessage: "I'd like to book {item}.",
  privacy:
    "Messages you send the assistant are shared with {business} so they can help you. Please don't share sensitive personal information.",
  poweredBy: "Powered by Traiblazer",
  defaultDescription:
    "{business}: services, prices, hours and contact details. Ask the assistant any question.",
};

type PageStrings = typeof en;
export type PageStringKey = keyof PageStrings;

const fr: PageStrings = {
  call: "Appeler",
  phone: "Téléphone",
  email: "Courriel",
  directions: "Itinéraire",
  book: "Réserver",
  website: "Site Web",
  shop: "Boutique en ligne",
  link: "Ouvrir le lien",
  openNow: "Ouvert",
  closedNow: "Fermé",
  closesAt: "ferme à {time}",
  opensAt: "ouvre {day} à {time}",
  opensTodayAt: "ouvre aujourd'hui à {time}",
  services: "Services",
  products: "Produits",
  servicesAndProducts: "Services et produits",
  photos: "Photos",
  hours: "Heures d'ouverture",
  closed: "Fermé",
  serviceArea: "Territoire desservi",
  areasServed: "Secteurs desservis",
  credentials: "Permis et assurances",
  languages: "Langues parlées",
  address: "Adresse",
  contact: "Coordonnées",
  notice: "Avis",
  chatHeading: "Posez-nous vos questions",
  chatHeadingPersonal: "Posez-moi vos questions",
  noScript: "Activez JavaScript pour discuter avec l'assistant, ou communiquez directement avec nous.",
  askAbout: "En savoir plus",
  requestQuote: "Demander une soumission",
  askMessage: "Parlez-moi de : {item}.",
  quoteMessage: "J'aimerais une soumission pour : {item}.",
  bookMessage: "J'aimerais réserver : {item}.",
  privacy:
    "Les messages envoyés à l'assistant sont transmis à {business} pour qu'on puisse vous aider. Veuillez ne pas partager de renseignements personnels sensibles.",
  poweredBy: "Propulsé par Traiblazer",
  defaultDescription:
    "{business} : services, prix, heures d'ouverture et coordonnées. Posez vos questions à l'assistant.",
};

const tables: Record<PageLanguage, PageStrings> = { en, fr };
export type PageLanguage = "en" | "fr";

export const pageLanguage = (code: string): PageLanguage => (code === "fr" ? "fr" : "en");

export function pageText(lang: PageLanguage, key: PageStringKey, vars: Record<string, string> = {}): string {
  return tables[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}
