import { cities, findCity } from "./cities.js";
import { industries } from "./industries.js";
import { absolute, paths } from "./pages.js";
import { type PublicPlan, planFacts } from "./plans.js";
import {
  FEATURES,
  GET_STARTED,
  PLANS_INCLUDE,
  PRICE_NOTE,
  SERVICE_AREA,
  SUMMARY,
  TAGLINE,
  WHO_FOR,
} from "./product.js";
import { formatAddress, type Lang, type SiteConfig } from "./site.js";

/**
 * The company's public facts as plain data, for the MCP server's tools. They are read from the same
 * cities, industries, product copy and site settings as the pages and llms.txt.
 */

function contact(site: SiteConfig) {
  return {
    ...(site.email ? { email: site.email } : {}),
    ...(site.phone ? { phone: site.phone } : {}),
    ...(site.address ? { address: formatAddress(site.address) } : {}),
  };
}

export function companyFacts(site: SiteConfig, lang: Lang) {
  return {
    name: site.brand,
    ...(site.legalName ? { legalName: site.legalName } : {}),
    tagline: TAGLINE[lang],
    summary: SUMMARY[lang],
    whoItIsFor: WHO_FOR[lang],
    serviceArea: SERVICE_AREA[lang],
    languages: ["en", "fr"],
    features: FEATURES.map((feature) => ({ title: feature.title[lang], description: feature.body[lang] })),
    website: site.siteUrl,
    links: {
      pricing: absolute(site, paths.pricing(lang)),
      cities: absolute(site, paths.cities(lang)),
      signup: absolute(site, paths.signup()),
      llmsTxt: absolute(site, paths.llms()),
    },
    contact: contact(site),
  };
}

export function industryFacts(lang: Lang) {
  return {
    industries: industries.map((industry) => ({
      id: industry.slug,
      name: industry.name[lang],
      businessTypes: [...industry.kinds[lang]],
      whatItDoes: [...industry.does[lang]],
      whatItWillNotDo: industry.limits[lang],
      questionsCustomersAsk: [...industry.sampleQuestions[lang]],
    })),
  };
}

export function pricingFacts(site: SiteConfig, plans: PublicPlan[], lang: Lang) {
  return {
    currency: "CAD",
    billingPeriod: "month",
    note: `${PRICE_NOTE[lang]} ${PLANS_INCLUDE[lang]}`,
    plans: plans.map(planFacts),
    pricingPage: absolute(site, paths.pricing(lang)),
  };
}

function cityEntry(site: SiteConfig, lang: Lang, slug: string) {
  const city = cities.find((c) => c.slug === slug)!;
  return {
    id: city.slug,
    name: city.name[lang],
    province: "Ontario",
    region: city.region[lang],
    nearbyCommunities: [...city.nearby],
    page: absolute(site, paths.city(lang, city.slug)),
    industryPages: industries.map((industry) => ({
      industry: industry.name[lang],
      url: absolute(site, paths.landing(lang, city.slug, industry.slug)),
    })),
  };
}

export function cityFacts(site: SiteConfig, lang: Lang) {
  return {
    serviceArea: SERVICE_AREA[lang],
    cities: cities.map((city) => cityEntry(site, lang, city.slug)),
  };
}

/**
 * Is a city served? The product is online, so the honest answer is always "yes, online"; what
 * differs is whether the city (or a community next to a listed city) has its own local pages.
 */
export function checkCity(site: SiteConfig, query: string, lang: Lang) {
  const match = findCity(query);
  const base = { query, availableOnline: true, serviceArea: SERVICE_AREA[lang] };
  if (!match) {
    return {
      ...base,
      hasLocalPage: false,
      note:
        lang === "fr"
          ? "Cette ville n'a pas encore de page locale. Traiblazer étant un logiciel en ligne, une entreprise de cette ville peut quand même s'inscrire et l'utiliser."
          : "This city doesn't have a local page yet. Traiblazer is online software, so a business there can still sign up and use it.",
      signup: absolute(site, paths.signup()),
    };
  }
  const { city, via } = match;
  return {
    ...base,
    hasLocalPage: true,
    matched: via === "city" ? ("city" as const) : ("nearby_community" as const),
    note:
      via === "city"
        ? lang === "fr"
          ? `${city.name.fr} a ses propres pages locales.`
          : `${city.name.en} has its own local pages.`
        : lang === "fr"
          ? `Cette localité est couverte par les pages ${city.name.fr}.`
          : `This community is covered by the ${city.name.en} pages.`,
    city: cityEntry(site, lang, city.slug),
    signup: absolute(site, paths.signup()),
  };
}

export function getStartedFacts(site: SiteConfig, lang: Lang) {
  return {
    howToStart: GET_STARTED[lang],
    signup: absolute(site, paths.signup()),
    pricing: absolute(site, paths.pricing(lang)),
    steps:
      lang === "fr"
        ? [
            "Créez un compte (essai gratuit).",
            "Ajoutez les renseignements de votre entreprise : site Web, liste de prix, dépliant, notes ou courte entrevue.",
            "Testez l'assistant, puis publiez votre page et partagez le lien ou le code QR.",
          ]
        : [
            "Create an account (free trial).",
            "Add your business information: website, price list, brochure, notes or a short interview.",
            "Test the assistant, then publish your page and share the link or QR code.",
          ],
    contact: contact(site),
  };
}
