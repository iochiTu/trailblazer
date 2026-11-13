import { describe, expect, it } from "vitest";
import {
  allPages,
  buildCityPage,
  buildLandingPage,
  buildLlmsFullTxt,
  buildLlmsTxt,
  checkCity,
  cities,
  findCity,
  industries,
  LANGS,
  landingPageLd,
  loadSiteConfig,
  type PublicPlan,
  priceLabel,
  pricingLd,
  serializeLd,
} from "./index.js";

const site = loadSiteConfig({ SITE_URL: "https://example.ca/" });
const plans: PublicPlan[] = [
  {
    id: "trial",
    nameEn: "Free trial",
    nameFr: "Essai gratuit",
    monthlyQuestions: 100,
    perMinute: 20,
    concurrent: 3,
    knowledgeImages: 20,
    priceMonthlyCents: 0,
  },
  {
    id: "local",
    nameEn: "Local",
    nameFr: "Local",
    monthlyQuestions: 1000,
    perMinute: 40,
    concurrent: 5,
    knowledgeImages: 50,
    priceMonthlyCents: 3900,
  },
  {
    id: "custom",
    nameEn: "Custom",
    nameFr: "Sur mesure",
    monthlyQuestions: 50000,
    perMinute: 300,
    concurrent: 1,
    knowledgeImages: 900,
    priceMonthlyCents: null,
  },
];

describe("site settings", () => {
  it("lists pages only on a real public address", () => {
    expect(site.siteUrl).toBe("https://example.ca");
    expect(site.indexable).toBe(true);
    expect(site.mcpUrl).toBe("https://example.ca/api/mcp");
    expect(loadSiteConfig({}).indexable).toBe(false);
    expect(loadSiteConfig({ SITE_URL: "http://example.ca" }).indexable).toBe(false);
    expect(loadSiteConfig({ SITE_URL: "https://10.0.0.5" }).indexable).toBe(false);
  });

  it("publishes only the business details that are set", () => {
    expect(site.email).toBeUndefined();
    expect(site.address).toBeUndefined();
    const full = loadSiteConfig({
      SITE_URL: "https://example.ca",
      BUSINESS_EMAIL: " hi@example.ca ",
      BUSINESS_CITY: "Thunder Bay",
    });
    expect(full.email).toBe("hi@example.ca");
    expect(full.address?.city).toBe("Thunder Bay");
  });
});

describe("cities and industries", () => {
  it("has complete English and French text for every entry", () => {
    for (const city of cities) {
      expect(city.slug).toMatch(/^[a-z0-9-]+$/);
      expect(city.nearby.length).toBeGreaterThan(0);
      for (const lang of LANGS) {
        for (const text of [city.name, city.region, city.about, city.context])
          expect(text[lang]).toBeTruthy();
      }
    }
    expect(industries.length).toBeGreaterThan(0);
    for (const industry of industries) {
      // Only industries businesses can choose today get a page.
      expect(industry.pack.phase).toBe(1);
      expect(industry.kinds.en).toHaveLength(industry.pack.variants.length);
      expect(industry.kinds.fr).toHaveLength(industry.kinds.en.length);
      expect(industry.does.fr).toHaveLength(industry.does.en.length);
      for (const lang of LANGS) expect(industry.sampleQuestions[lang].length).toBeGreaterThan(0);
    }
  });

  it("has unique slugs", () => {
    expect(new Set(cities.map((c) => c.slug)).size).toBe(cities.length);
    expect(new Set(industries.map((i) => i.slug)).size).toBe(industries.length);
  });

  it("finds a city by name, alias, accents and nearby community", () => {
    expect(findCity("THUNDER BAY")?.city.slug).toBe("thunder-bay");
    expect(findCity("Sault-Sainte-Marie, Ontario")?.city.slug).toBe("sault-ste-marie");
    expect(findCity("Sudbury")?.city.slug).toBe("sudbury");
    expect(findCity("Val Caron")).toMatchObject({ via: "nearby", city: { slug: "sudbury" } });
    expect(findCity("Vancouver")).toBeUndefined();
    expect(findCity("  ")).toBeUndefined();
  });
});

describe("landing pages", () => {
  const every = cities.flatMap((city) =>
    industries.flatMap((industry) => LANGS.map((lang) => buildLandingPage(lang, city, industry))),
  );

  it("gives every page its own title, description, heading and address", () => {
    for (const field of ["title", "description", "heading", "path"] as const) {
      expect(new Set(every.map((page) => page[field])).size, field).toBe(every.length);
    }
  });

  it("names the city and links both languages", () => {
    const page = buildLandingPage("fr", cities[0]!, industries[0]!);
    expect(page.title).toContain("Thunder Bay");
    expect(page.path).toBe("/fr/local/thunder-bay/trades");
    expect(page.alternates).toEqual({
      en: "/en/local/thunder-bay/trades",
      fr: "/fr/local/thunder-bay/trades",
    });
    expect(page.faqs.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps search descriptions to a readable length", () => {
    for (const page of every) expect(page.description.length, page.path).toBeLessThanOrEqual(190);
  });

  it("describes the service, its area and its questions as structured data", () => {
    const page = buildLandingPage("en", cities[0]!, industries[0]!);
    const graph = landingPageLd(site, page, "Cities")["@graph"] as Record<string, unknown>[];
    expect(graph.map((node) => node["@type"])).toEqual([
      "Organization",
      "Service",
      "FAQPage",
      "BreadcrumbList",
    ]);
    const service = graph[1] as { areaServed: { name: string }[]; url: string };
    expect(service.url).toBe("https://example.ca/en/local/thunder-bay/trades");
    expect(service.areaServed[0]?.name).toBe("Thunder Bay");
    // No invented contact details.
    expect(graph[0]).not.toHaveProperty("address");
    expect(graph[0]).not.toHaveProperty("telephone");
    expect(serializeLd({ text: "</script>" })).not.toContain("<");
  });

  it("lists every industry on a city page", () => {
    expect(buildCityPage("en", cities[0]!).industries).toHaveLength(industries.length);
  });

  it("lists every page once for the sitemap", () => {
    const pages = allPages();
    expect(pages.filter((page) => page.kind === "landing")).toHaveLength(cities.length * industries.length);
    const addresses = pages.flatMap((page) => [page.paths.en, page.paths.fr]);
    expect(new Set(addresses).size).toBe(addresses.length - 1); // the home page has one address
  });
});

describe("pricing", () => {
  it("formats prices in each language", () => {
    expect(priceLabel(plans[0]!, "en")).toBe("Free");
    expect(priceLabel(plans[1]!, "en")).toBe("$39 per month");
    expect(priceLabel(plans[1]!, "fr").replace(/\s/g, " ")).toBe("39 $ par mois");
    expect(priceLabel(plans[2]!, "fr")).toBe("Contactez-nous");
  });

  it("publishes an Offer only for plans with a price", () => {
    const graph = pricingLd(site, plans, "en")["@graph"] as { offers?: Record<string, unknown>[] }[];
    const offers = graph[1]?.offers ?? [];
    expect(offers.map((offer) => [offer.name, offer.price, offer.priceCurrency])).toEqual([
      ["Free trial", "0.00", "CAD"],
      ["Local", "39.00", "CAD"],
    ]);
  });
});

describe("llms.txt", () => {
  it("states the prices it was given and links the key pages", () => {
    const text = buildLlmsTxt(site, plans);
    expect(text.startsWith("# Traiblazer\n\n> ")).toBe(true);
    expect(text).toContain("- Local: $39 per month.");
    expect(text).toContain("https://example.ca/en/pricing");
    expect(text).toContain("https://example.ca/api/mcp");
    expect(text).toContain("[Thunder Bay](https://example.ca/en/local/thunder-bay)");
  });

  it("quotes no prices when the plans couldn't be loaded", () => {
    const text = buildLlmsTxt(site, null);
    expect(text).not.toMatch(/\$\d/);
    expect(text).toContain("on the pricing page");
  });

  it("links every landing page in the full version", () => {
    const text = buildLlmsFullTxt(site, plans);
    for (const page of allPages().filter((p) => p.kind === "landing")) {
      expect(text).toContain(`https://example.ca${page.paths.en})`);
    }
  });
});

describe("city check", () => {
  it("says a place without a page can still use the product", () => {
    expect(checkCity(site, "Winnipeg", "en")).toMatchObject({ hasLocalPage: false, availableOnline: true });
    expect(checkCity(site, "Timmins", "fr")).toMatchObject({ hasLocalPage: true, matched: "city" });
  });
});
