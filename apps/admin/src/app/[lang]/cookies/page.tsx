import { alternates, COOKIES_POLICY, paths } from "@traiblazer/marketing";
import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { langOr404, pageMetadata, siteConfig } from "@/lib/site";

type Params = Promise<{ lang: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const lang = langOr404((await params).lang);
  const doc = COOKIES_POLICY[lang];
  return pageMetadata({
    site: siteConfig(),
    lang,
    title: `${doc.title} | Traiblazer`,
    description: doc.description,
    alternates: alternates(paths.cookies),
  });
}

/** Cookies Policy: what the site stores in the browser and why. */
export default async function CookiesPage({ params }: { params: Params }) {
  const lang = langOr404((await params).lang);
  return (
    <LegalPage
      site={siteConfig()}
      lang={lang}
      doc={COOKIES_POLICY[lang]}
      alternates={alternates(paths.cookies)}
    />
  );
}
