import {
  alternates,
  GENERAL_FAQS,
  PLANS_INCLUDE,
  PRICE_NOTE,
  paths,
  planIncludes,
  planName,
  priceLabel,
  pricingLd,
  UI,
} from "@traiblazer/marketing";
import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/site/JsonLd";
import { Block, SiteShell, StartCta } from "@/components/site/SiteShell";
import { fetchPlans, langOr404, pageMetadata, siteConfig } from "@/lib/site";

type Params = Promise<{ lang: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const lang = langOr404((await params).lang);
  return pageMetadata({
    site: siteConfig(),
    lang,
    title: `${UI[lang].pricingTitle} | Traiblazer`,
    description: `${UI[lang].pricingLead} ${PRICE_NOTE[lang]}`,
    alternates: alternates(paths.pricing),
  });
}

/**
 * Pricing page. The plans are the active ones in the operator console (read through the API), so
 * the page, its structured data, llms.txt and the MCP server always show the same prices.
 */
export default async function PricingPage({ params }: { params: Params }) {
  const lang = langOr404((await params).lang);
  const site = siteConfig();
  const ui = UI[lang];
  const plans = await fetchPlans();

  return (
    <SiteShell site={site} lang={lang} alternates={alternates(paths.pricing)}>
      {plans && <JsonLd data={pricingLd(site, plans, lang)} />}

      <section className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-4 pt-10 pb-2 text-center sm:pt-16">
        <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
          {ui.pricingTitle}
        </h1>
        <p className="muted text-lg">{ui.pricingLead}</p>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10">
        {plans ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
            {plans.map((plan) => (
              <li key={plan.id} id={plan.id} className="card flex scroll-mt-24 flex-col gap-5 p-6">
                <div className="flex flex-col gap-2">
                  <h2 className="text-lg font-semibold">{planName(plan, lang)}</h2>
                  <p className="text-2xl font-semibold tracking-tight">{priceLabel(plan, lang)}</p>
                </div>
                <ul className="flex flex-1 flex-col gap-2 text-sm">
                  {planIncludes(plan, lang).map((line) => (
                    <li key={line}>{line.charAt(0).toUpperCase() + line.slice(1)}</li>
                  ))}
                </ul>
                <Link href={paths.signup()} className="btn btn-ghost w-full">
                  {ui.choose}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted text-center">{ui.pricingUnavailable}</p>
        )}
        <p className="muted text-center text-sm">
          {PLANS_INCLUDE[lang]} {PRICE_NOTE[lang]}
        </p>
      </section>

      <Block title={ui.faqTitle}>
        <div className="flex flex-col gap-3">
          {GENERAL_FAQS[lang].map((faq) => (
            <details key={faq.question} className="card portal-faq px-6 py-1">
              <summary className="cursor-pointer list-none py-4 font-medium">{faq.question}</summary>
              <p className="muted pb-5 text-sm">{faq.answer}</p>
            </details>
          ))}
        </div>
      </Block>

      <StartCta lang={lang} />
    </SiteShell>
  );
}
