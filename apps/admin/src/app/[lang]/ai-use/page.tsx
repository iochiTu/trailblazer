import { AI_DISCLAIMER, alternates, paths } from "@traiblazer/marketing";
import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { langOr404, pageMetadata, siteConfig } from "@/lib/site";

type Params = Promise<{ lang: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const lang = langOr404((await params).lang);
  const doc = AI_DISCLAIMER[lang];
  return pageMetadata({
    site: siteConfig(),
    lang,
    title: `${doc.title} | Traiblazer`,
    description: doc.description,
    alternates: alternates(paths.aiUse),
  });
}

/** AI usage disclaimer: what the assistants are, where answers come from and their limits. */
export default async function AiUsePage({ params }: { params: Params }) {
  const lang = langOr404((await params).lang);
  return (
    <LegalPage
      site={siteConfig()}
      lang={lang}
      doc={AI_DISCLAIMER[lang]}
      alternates={alternates(paths.aiUse)}
    />
  );
}
