import { isLang, type Lang, loadSiteConfig, type PublicPlan, type SiteConfig } from "@traiblazer/marketing";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

/** Site settings (SITE_URL, BUSINESS_*), read when a request comes in. */
export function siteConfig(): SiteConfig {
  return loadSiteConfig(process.env, "http://localhost:3000");
}

/** The language in the address, or a 404 for anything else. */
export function langOr404(value: string): Lang {
  if (!isLang(value)) notFound();
  return value;
}

/**
 * Active plans from the API (the ones operators keep in the operator console), refreshed every five
 * minutes. Null when the API can't be reached: pages then say so instead of showing stale numbers.
 */
export async function fetchPlans(): Promise<PublicPlan[] | null> {
  const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${api}/v1/catalog/plans`, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    const body = (await response.json()) as { plans: PublicPlan[] };
    return body.plans;
  } catch {
    return null;
  }
}

/** Title, description, canonical address and language alternates for a marketing page. */
export function pageMetadata(input: {
  site: SiteConfig;
  lang: Lang;
  title: string;
  description: string;
  alternates: Record<Lang, string>;
}): Metadata {
  const { site, lang, title, description, alternates } = input;
  const url = (path: string) => `${site.siteUrl}${path}`;
  return {
    title,
    description,
    alternates: {
      canonical: url(alternates[lang]),
      languages: {
        "en-CA": url(alternates.en),
        "fr-CA": url(alternates.fr),
        "x-default": url(alternates.en),
      },
    },
    openGraph: {
      title,
      description,
      url: url(alternates[lang]),
      siteName: site.brand,
      locale: lang === "fr" ? "fr_CA" : "en_CA",
      type: "website",
    },
    // Not listed by search engines until SITE_URL is a real public address.
    ...(site.indexable ? {} : { robots: { index: false, follow: false } }),
  };
}
