import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * /robots.txt. The public pages are open to search engines and AI crawlers; the signed-in portal and
 * the API are not. Until SITE_URL is a real public address, everything is closed.
 */
export default function robots(): MetadataRoute.Robots {
  const site = siteConfig();
  if (!site.indexable) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/operator", "/t/", "/api/"],
    },
    sitemap: `${site.siteUrl}/sitemap.xml`,
    host: site.siteUrl,
  };
}
