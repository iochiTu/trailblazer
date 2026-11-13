/**
 * Who we are and where the public site lives. Everything here comes from settings (environment
 * variables), never from guesses: a detail that isn't set is simply left off the pages, the
 * structured data, llms.txt and the MCP answers.
 */

export type Lang = "en" | "fr";
export const LANGS: readonly Lang[] = ["en", "fr"];
export type Localized = Record<Lang, string>;

export function isLang(value: string): value is Lang {
  return value === "en" || value === "fr";
}

export interface PostalAddress {
  street?: string;
  city?: string;
  /** Province code, e.g. "ON". */
  region?: string;
  postalCode?: string;
  /** Country code, e.g. "CA". */
  country?: string;
}

export interface SiteConfig {
  /** Public origin of the marketing site, without a trailing slash. */
  siteUrl: string;
  /** Public address of the MCP server AI assistants connect to. */
  mcpUrl: string;
  /**
   * False until SITE_URL points at a real public domain. While false, pages ask search engines not
   * to list them and robots.txt blocks everything, so a preview or local copy never gets indexed.
   */
  indexable: boolean;
  brand: string;
  /** Registered company name, when it differs from the brand. */
  legalName?: string;
  email?: string;
  phone?: string;
  address?: PostalAddress;
}

export const BRAND = "Traiblazer";

const clean = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

function isPublicOrigin(url: URL): boolean {
  const host = url.hostname;
  if (url.protocol !== "https:") return false;
  return !(
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^[\d.:[\]]+$/.test(host)
  );
}

/**
 * Reads the site settings. `fallbackUrl` is used when SITE_URL isn't set (local development).
 *
 * SITE_URL            public origin of the marketing site, e.g. https://example.ca
 * MCP_PUBLIC_URL      public address of the MCP server (default: SITE_URL + /api/mcp)
 * BUSINESS_LEGAL_NAME, BUSINESS_EMAIL, BUSINESS_PHONE,
 * BUSINESS_STREET, BUSINESS_CITY, BUSINESS_REGION, BUSINESS_POSTAL_CODE, BUSINESS_COUNTRY
 */
export function loadSiteConfig(
  env: Record<string, string | undefined>,
  fallbackUrl = "http://localhost:3000",
): SiteConfig {
  const url = new URL(clean(env.SITE_URL) ?? fallbackUrl);
  const siteUrl = url.origin;
  const address: PostalAddress = {
    street: clean(env.BUSINESS_STREET),
    city: clean(env.BUSINESS_CITY),
    region: clean(env.BUSINESS_REGION),
    postalCode: clean(env.BUSINESS_POSTAL_CODE),
    country: clean(env.BUSINESS_COUNTRY),
  };
  const hasAddress = Object.values(address).some(Boolean);
  return {
    siteUrl,
    mcpUrl: clean(env.MCP_PUBLIC_URL) ?? `${siteUrl}/api/mcp`,
    indexable: isPublicOrigin(url),
    brand: BRAND,
    legalName: clean(env.BUSINESS_LEGAL_NAME),
    email: clean(env.BUSINESS_EMAIL),
    phone: clean(env.BUSINESS_PHONE),
    ...(hasAddress ? { address } : {}),
  };
}

/** One line for a footer or llms.txt, e.g. "12 Main St, Thunder Bay, ON P7B 1A1". */
export function formatAddress(address: PostalAddress): string {
  const tail = [address.region, address.postalCode].filter(Boolean).join(" ");
  return [address.street, address.city, tail, address.country].filter(Boolean).join(", ");
}
