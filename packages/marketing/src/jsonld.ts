import type { CityPage, Faq, LandingPage } from "./pages.js";
import { absolute, paths } from "./pages.js";
import { PRICE_CURRENCY, type PublicPlan, planIncludes, planName } from "./plans.js";
import { SUMMARY, TAGLINE } from "./product.js";
import type { Lang, SiteConfig } from "./site.js";

/**
 * schema.org structured data (JSON-LD) for the public pages. Contact details appear only when they
 * are set in the site settings; nothing is filled in with a placeholder.
 */

type Json = Record<string, unknown>;

const CONTEXT = "https://schema.org";

/** The company. Referenced from the other objects by its `@id`. */
export function organizationLd(site: SiteConfig, lang: Lang): Json {
  const address = site.address;
  return {
    "@type": "Organization",
    "@id": `${site.siteUrl}/#organization`,
    name: site.brand,
    ...(site.legalName ? { legalName: site.legalName } : {}),
    url: site.siteUrl,
    description: SUMMARY[lang],
    slogan: TAGLINE[lang],
    ...(site.email ? { email: site.email } : {}),
    ...(site.phone ? { telephone: site.phone } : {}),
    ...(address
      ? {
          address: {
            "@type": "PostalAddress",
            ...(address.street ? { streetAddress: address.street } : {}),
            ...(address.city ? { addressLocality: address.city } : {}),
            ...(address.region ? { addressRegion: address.region } : {}),
            ...(address.postalCode ? { postalCode: address.postalCode } : {}),
            ...(address.country ? { addressCountry: address.country } : {}),
          },
        }
      : {}),
  };
}

function faqLd(faqs: Faq[]): Json {
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

function breadcrumbLd(site: SiteConfig, items: { name: string; path: string }[]): Json {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolute(site, item.path),
    })),
  };
}

const cityLd = (name: string) => ({
  "@type": "City",
  name,
  containedInPlace: { "@type": "AdministrativeArea", name: "Ontario, Canada" },
});

/** Landing page: the service offered in that city, its questions and the breadcrumb trail. */
export function landingPageLd(site: SiteConfig, page: LandingPage, citiesLabel: string): Json {
  const { lang, city, industry } = page;
  return {
    "@context": CONTEXT,
    "@graph": [
      organizationLd(site, lang),
      {
        "@type": "Service",
        "@id": `${absolute(site, page.path)}#service`,
        name: page.heading,
        description: page.description,
        serviceType: lang === "fr" ? "Assistant IA et page d'entreprise" : "AI assistant and business page",
        url: absolute(site, page.path),
        inLanguage: lang,
        provider: { "@id": `${site.siteUrl}/#organization` },
        areaServed: [cityLd(city.name[lang]), ...city.nearby.map((name) => ({ "@type": "Place", name }))],
        audience: { "@type": "BusinessAudience", audienceType: industry.name[lang] },
      },
      faqLd(page.faqs),
      breadcrumbLd(site, [
        { name: site.brand, path: paths.home() },
        { name: citiesLabel, path: paths.cities(lang) },
        { name: city.name[lang], path: paths.city(lang, city.slug) },
        { name: industry.name[lang], path: page.path },
      ]),
    ],
  };
}

export function cityPageLd(site: SiteConfig, page: CityPage, citiesLabel: string): Json {
  const { lang, city } = page;
  return {
    "@context": CONTEXT,
    "@graph": [
      organizationLd(site, lang),
      {
        "@type": "Service",
        name: page.heading,
        description: page.description,
        url: absolute(site, page.path),
        inLanguage: lang,
        provider: { "@id": `${site.siteUrl}/#organization` },
        areaServed: cityLd(city.name[lang]),
      },
      breadcrumbLd(site, [
        { name: site.brand, path: paths.home() },
        { name: citiesLabel, path: paths.cities(lang) },
        { name: city.name[lang], path: page.path },
      ]),
    ],
  };
}

/**
 * Pricing page: the product with one `Offer` per plan that has a published price. Plans priced
 * "contact us" are left out, since an Offer without a price would mislead.
 */
export function pricingLd(site: SiteConfig, plans: PublicPlan[], lang: Lang): Json {
  const url = absolute(site, paths.pricing(lang));
  const offers = plans.flatMap((plan) => {
    if (plan.priceMonthlyCents === null) return [];
    const price = (plan.priceMonthlyCents / 100).toFixed(2);
    return [
      {
        "@type": "Offer",
        name: planName(plan, lang),
        description: planIncludes(plan, lang).join("; "),
        url: `${url}#${plan.id}`,
        price,
        priceCurrency: PRICE_CURRENCY,
        availability: "https://schema.org/InStock",
        eligibleRegion: { "@type": "Country", name: "CA" },
        // The price is per month, before taxes.
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price,
          priceCurrency: PRICE_CURRENCY,
          billingDuration: "P1M",
          valueAddedTaxIncluded: false,
        },
        seller: { "@id": `${site.siteUrl}/#organization` },
      },
    ];
  });
  return {
    "@context": CONTEXT,
    "@graph": [
      organizationLd(site, lang),
      {
        "@type": "SoftwareApplication",
        "@id": `${site.siteUrl}/#product`,
        name: site.brand,
        description: SUMMARY[lang],
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url,
        inLanguage: ["en", "fr"],
        provider: { "@id": `${site.siteUrl}/#organization` },
        ...(offers.length ? { offers } : {}),
      },
    ],
  };
}

/** Safe to place inside a `<script type="application/ld+json">` tag. */
export function serializeLd(data: Json): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
