import { allPages } from "@traiblazer/marketing";
import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

// Built per request so SITE_URL is read from the running server's settings.
export const dynamic = "force-dynamic";

/** /sitemap.xml: every public marketing page, each with its English and French address. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteConfig();
  const url = (path: string) => `${site.siteUrl}${path === "/" ? "" : path}`;
  return allPages().flatMap((page) => {
    const languages = { "en-CA": url(page.paths.en), "fr-CA": url(page.paths.fr) };
    const translated = page.paths.en !== page.paths.fr;
    const entry = (path: string) => ({
      url: url(path),
      changeFrequency: page.kind === "pricing" ? ("weekly" as const) : ("monthly" as const),
      priority: page.kind === "home" ? 1 : page.kind === "landing" ? 0.7 : 0.8,
      ...(translated ? { alternates: { languages } } : {}),
    });
    return translated ? [entry(page.paths.en), entry(page.paths.fr)] : [entry(page.paths.en)];
  });
}
