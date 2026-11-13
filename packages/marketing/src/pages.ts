import { type City, cities } from "./cities.js";
import { type Industry, industries } from "./industries.js";
import { FEATURES, type Feature } from "./product.js";
import type { Lang, SiteConfig } from "./site.js";

/**
 * The public pages as data: every address on the site, and for each landing page its title,
 * description, headings, text and questions. The Next.js routes only lay this out; the sitemap,
 * llms.txt and the MCP server read the same functions.
 */

// ---- Addresses --------------------------------------------------------------------------------

export const paths = {
  home: () => "/",
  signup: () => "/signup",
  pricing: (lang: Lang) => `/${lang}/pricing`,
  cities: (lang: Lang) => `/${lang}/local`,
  city: (lang: Lang, city: string) => `/${lang}/local/${city}`,
  landing: (lang: Lang, city: string, industry: string) => `/${lang}/local/${city}/${industry}`,
  llms: () => "/llms.txt",
  llmsFull: () => "/llms-full.txt",
};

export const absolute = (site: SiteConfig, path: string) => `${site.siteUrl}${path === "/" ? "" : path}`;

/** The same page in each language, for `hreflang` links. */
export function alternates(pathFor: (lang: Lang) => string): Record<Lang, string> {
  return { en: pathFor("en"), fr: pathFor("fr") };
}

// ---- Words ------------------------------------------------------------------------------------

/** French elision: "de Thunder Bay", but "d'Ottawa". */
const de = (name: string) => (/^[aeiouyhàâéèêîôû]/i.test(name) ? `d'${name}` : `de ${name}`);

const listOf = (items: string[], lang: Lang) =>
  new Intl.ListFormat(lang === "fr" ? "fr-CA" : "en-CA", { style: "long", type: "conjunction" }).format(
    items,
  );

export const UI = {
  en: {
    nav: { home: "Home", cities: "Cities", pricing: "Pricing", signIn: "Sign in", start: "Start free trial" },
    otherLanguage: "Français",
    breadcrumbCities: "Cities",
    whoTitle: "Who it is for",
    doesTitle: "What it does for you",
    limitsTitle: "What it will not do",
    questionsTitle: "Questions customers ask",
    questionsLead: "The assistant suggests these to visitors and answers them from your information:",
    featuresTitle: "What you get",
    faqTitle: "Common questions",
    ctaTitle: "Try it with your own business",
    ctaBody: "Create an account, add your information and test the assistant before customers see it.",
    seePricing: "See pricing",
    otherIndustries: (city: string) => `Other industries in ${city}`,
    otherCities: "Other cities",
    industriesIn: (city: string) => `Industries in ${city}`,
    footerNote: "AI assistants and business pages for small local businesses.",
    forAi: "For AI assistants",
    pricingTitle: "Pricing",
    pricingLead: "Simple monthly plans. Start with the free trial and move up when you need more.",
    pricingUnavailable: "Plans couldn't be loaded right now. Please try again later.",
    pricingAll: "Every plan includes the business page, the assistant in every language and all features.",
    choose: "Get started",
    citiesTitle: "AI assistants for local businesses, city by city",
    citiesLead: "Traiblazer is online, so any business can use it. These cities have their own pages:",
  },
  fr: {
    nav: {
      home: "Accueil",
      cities: "Villes",
      pricing: "Tarifs",
      signIn: "Connexion",
      start: "Commencer l'essai gratuit",
    },
    otherLanguage: "English",
    breadcrumbCities: "Villes",
    whoTitle: "À qui il s'adresse",
    doesTitle: "Ce qu'il fait pour vous",
    limitsTitle: "Ce qu'il ne fera pas",
    questionsTitle: "Les questions que posent les clients",
    questionsLead: "L'assistant les propose aux visiteurs et y répond à partir de vos renseignements :",
    featuresTitle: "Ce que vous obtenez",
    faqTitle: "Questions fréquentes",
    ctaTitle: "Essayez-le avec votre propre entreprise",
    ctaBody:
      "Créez un compte, ajoutez vos renseignements et testez l'assistant avant que les clients le voient.",
    seePricing: "Voir les tarifs",
    otherIndustries: (city: string) => `Autres secteurs à ${city}`,
    otherCities: "Autres villes",
    industriesIn: (city: string) => `Secteurs à ${city}`,
    footerNote: "Assistants IA et pages d'entreprise pour les petites entreprises locales.",
    forAi: "Pour les assistants IA",
    pricingTitle: "Tarifs",
    pricingLead:
      "Des forfaits mensuels simples. Commencez par l'essai gratuit et passez au suivant au besoin.",
    pricingUnavailable: "Les forfaits n'ont pas pu être chargés. Veuillez réessayer plus tard.",
    pricingAll:
      "Chaque forfait comprend la page d'entreprise, l'assistant dans toutes les langues et toutes les fonctions.",
    choose: "Commencer",
    citiesTitle: "Des assistants IA pour les entreprises locales, ville par ville",
    citiesLead:
      "Traiblazer est en ligne : toute entreprise peut l'utiliser. Ces villes ont leurs propres pages :",
  },
} as const;

// ---- Landing page (one city, one industry) ----------------------------------------------------

export interface Faq {
  question: string;
  answer: string;
}

export interface LandingPage {
  lang: Lang;
  city: City;
  industry: Industry;
  path: string;
  alternates: Record<Lang, string>;
  /** Browser title and search result title. */
  title: string;
  /** Search result description, about 150 characters. */
  description: string;
  heading: string;
  /** Opening paragraphs: the owner's problem, then the place. */
  lead: string[];
  /** The trades or business types covered. */
  kinds: string[];
  does: string[];
  limits: string;
  sampleQuestions: string[];
  features: Feature[];
  faqs: Faq[];
}

/** Questions that are the same on every page: language, where answers come from, cost. */
export const GENERAL_FAQS: Record<Lang, [Faq, Faq, Faq]> = {
  en: [
    {
      question: "Does the assistant answer in French?",
      answer:
        "Yes. The portal is in English and French, and the assistant answers each visitor in the language they write in.",
    },
    {
      question: "Where do the answers come from?",
      answer:
        "Only from your business's own information. The assistant doesn't invent prices, stock or availability; when it doesn't know, it says so and offers to put the customer in touch with you.",
    },
    {
      question: "How much does it cost?",
      answer:
        "There is a free trial, then monthly plans in Canadian dollars, before taxes. The current prices are on the pricing page.",
    },
  ],
  fr: [
    {
      question: "L'assistant répond-il en français?",
      answer:
        "Oui. Le portail est en français et en anglais, et l'assistant répond à chaque visiteur dans la langue qu'il utilise.",
    },
    {
      question: "D'où viennent les réponses?",
      answer:
        "Uniquement des renseignements de votre entreprise. L'assistant n'invente ni prix, ni stock, ni disponibilité; quand il ne sait pas, il le dit et propose de vous joindre.",
    },
    {
      question: "Combien ça coûte?",
      answer:
        "Il y a un essai gratuit, puis des forfaits mensuels en dollars canadiens, avant taxes. Les prix à jour sont sur la page Tarifs.",
    },
  ],
};

function landingFaqs(lang: Lang, city: City, industry: Industry): Faq[] {
  const name = city.name[lang];
  const nearby = listOf(city.nearby, lang);
  const audience = industry.audience[lang];
  const [language, sources, cost] = GENERAL_FAQS[lang];
  const local: [Faq, Faq, Faq] =
    lang === "fr"
      ? [
          {
            question: `Faut-il un site Web pour utiliser Traiblazer à ${name}?`,
            answer:
              "Non. Traiblazer crée votre page d'entreprise à partir de ce que vous avez déjà : une liste de prix, un dépliant, des photos, vos notes et une courte entrevue. Si vous avez un site Web, l'assistant peut aussi le lire et s'y intégrer.",
          },
          {
            question: `Mon entreprise dessert aussi ${nearby}. L'assistant le sait-il?`,
            answer: `Oui. Vous indiquez les localités que vous desservez autour ${de(name)}, et l'assistant vérifie le secteur du client avant de prendre une demande.`,
          },
          { question: `Que ne fera pas l'assistant pour les ${audience}?`, answer: industry.limits.fr },
        ]
      : [
          {
            question: `Do I need a website to use Traiblazer in ${name}?`,
            answer:
              "No. Traiblazer builds your business page from what you already have: a price list, a brochure, photos, your notes and a short interview. If you do have a website, the assistant can read it and be added to it too.",
          },
          {
            question: `My business also serves ${nearby}. Does the assistant know that?`,
            answer: `Yes. You list the towns you serve around ${name}, and the assistant checks the customer's area before it takes a request.`,
          },
          { question: `What will the assistant not do for ${audience}?`, answer: industry.limits.en },
        ];
  return [local[0], language, local[1], sources, local[2], cost];
}

export function buildLandingPage(lang: Lang, city: City, industry: Industry): LandingPage {
  const name = city.name[lang];
  const audience = industry.audience[lang];
  const kinds = industry.kinds[lang];
  const title =
    lang === "fr"
      ? `Assistant IA pour ${audience} à ${name} | Traiblazer`
      : `AI assistant for ${audience} in ${name} | Traiblazer`;
  const heading =
    lang === "fr" ? `Assistant IA pour ${audience} à ${name}` : `AI assistant for ${audience} in ${name}`;
  const description =
    lang === "fr"
      ? `Page d'entreprise et assistant IA pour ${audience} ${de(name)} : répond aux clients en français et en anglais et prend leurs demandes.`
      : `A business page and AI assistant for ${audience} in ${name}: it answers customers in English and French and takes their requests.`;
  const serving =
    lang === "fr"
      ? `Traiblazer aide les ${audience} ${de(name)} et des environs (${listOf(city.nearby, lang)}) à répondre à chaque client, même quand personne ne peut prendre le téléphone.`
      : `Traiblazer helps ${audience} in ${name} and the communities around it (${listOf(city.nearby, lang)}) answer every customer, even when nobody can pick up the phone.`;
  return {
    lang,
    city,
    industry,
    path: paths.landing(lang, city.slug, industry.slug),
    alternates: alternates((l) => paths.landing(l, city.slug, industry.slug)),
    title,
    description,
    heading,
    lead: [industry.problem[lang], serving, `${city.about[lang]} ${city.context[lang]}`],
    kinds: [...kinds],
    does: [...industry.does[lang]],
    limits: industry.limits[lang],
    sampleQuestions: [...industry.sampleQuestions[lang]],
    features: FEATURES,
    faqs: landingFaqs(lang, city, industry),
  };
}

// ---- City page (one city, every industry) -----------------------------------------------------

export interface CityPage {
  lang: Lang;
  city: City;
  path: string;
  alternates: Record<Lang, string>;
  title: string;
  description: string;
  heading: string;
  lead: string[];
  industries: { industry: Industry; path: string; label: string }[];
}

export function buildCityPage(lang: Lang, city: City): CityPage {
  const name = city.name[lang];
  const region = city.region[lang];
  return {
    lang,
    city,
    path: paths.city(lang, city.slug),
    alternates: alternates((l) => paths.city(l, city.slug)),
    title:
      lang === "fr"
        ? `Assistant IA pour les entreprises ${de(name)} | Traiblazer`
        : `AI assistant for local businesses in ${name} | Traiblazer`,
    description:
      lang === "fr"
        ? `Traiblazer donne aux entreprises ${de(name)} (${region}) une page d'entreprise et un assistant IA qui répond aux clients en français et en anglais.`
        : `Traiblazer gives businesses in ${name}, ${region}, a business page and an AI assistant that answers customers in English and French.`,
    heading:
      lang === "fr"
        ? `Assistant IA pour les entreprises ${de(name)}`
        : `AI assistant for local businesses in ${name}`,
    lead: [city.about[lang], city.context[lang]],
    industries: industries.map((industry) => ({
      industry,
      path: paths.landing(lang, city.slug, industry.slug),
      label: industry.name[lang],
    })),
  };
}

// ---- Every page -------------------------------------------------------------------------------

export interface SitePage {
  /** Path in each language; a page without translations has the same path in both. */
  paths: Record<Lang, string>;
  kind: "home" | "pricing" | "cities" | "city" | "landing";
}

/** Every public marketing page, for the sitemap and llms.txt. */
export function allPages(): SitePage[] {
  return [
    { kind: "home", paths: { en: paths.home(), fr: paths.home() } },
    { kind: "pricing", paths: alternates(paths.pricing) },
    { kind: "cities", paths: alternates(paths.cities) },
    ...cities.map((c): SitePage => ({ kind: "city", paths: alternates((l) => paths.city(l, c.slug)) })),
    ...cities.flatMap((c) =>
      industries.map(
        (i): SitePage => ({ kind: "landing", paths: alternates((l) => paths.landing(l, c.slug, i.slug)) }),
      ),
    ),
  ];
}
