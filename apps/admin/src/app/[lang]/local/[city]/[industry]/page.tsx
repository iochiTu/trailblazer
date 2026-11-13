import {
  buildLandingPage,
  cities,
  getCity,
  getIndustry,
  industries,
  landingPageLd,
  paths,
  UI,
} from "@traiblazer/marketing";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/site/JsonLd";
import { Block, Breadcrumbs, SiteShell, StartCta } from "@/components/site/SiteShell";
import { langOr404, pageMetadata, siteConfig } from "@/lib/site";

type Params = Promise<{ lang: string; city: string; industry: string }>;

/** The page for one industry in one city, or a 404 when either isn't on the list. */
async function load(params: Params) {
  const { lang: rawLang, city: citySlug, industry: industrySlug } = await params;
  const lang = langOr404(rawLang);
  const city = getCity(citySlug);
  const industry = getIndustry(industrySlug);
  if (!city || !industry) notFound();
  return buildLandingPage(lang, city, industry);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = await load(params);
  return pageMetadata({ site: siteConfig(), ...page });
}

/** Landing page: "AI assistant for <industry> in <city>". All of its text comes from `@traiblazer/marketing`. */
export default async function LandingPage({ params }: { params: Params }) {
  const page = await load(params);
  const { lang, city, industry } = page;
  const site = siteConfig();
  const ui = UI[lang];
  const [problem, ...place] = page.lead;

  return (
    <SiteShell site={site} lang={lang} alternates={page.alternates}>
      <JsonLd data={landingPageLd(site, page, ui.breadcrumbCities)} />

      <section className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-10 pb-6 sm:pt-16">
        <Breadcrumbs
          items={[
            { label: site.brand, href: paths.home() },
            { label: ui.breadcrumbCities, href: paths.cities(lang) },
            { label: city.name[lang], href: paths.city(lang, city.slug) },
            { label: industry.name[lang] },
          ]}
        />
        <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
          {page.heading}
        </h1>
        <p className="text-xl">{problem}</p>
        {place.map((paragraph) => (
          <p key={paragraph} className="muted text-lg">
            {paragraph}
          </p>
        ))}
        <div className="flex flex-wrap gap-3">
          <Link href={paths.signup()} className="btn px-6 py-3 text-base">
            {ui.nav.start}
          </Link>
          <Link href={paths.pricing(lang)} className="btn btn-ghost px-6 py-3 text-base">
            {ui.seePricing}
          </Link>
        </div>
      </section>

      <Block title={ui.whoTitle}>
        <ul className="flex flex-wrap gap-2">
          {page.kinds.map((kind) => (
            <li key={kind} className="badge badge-accent px-3 py-1 text-sm">
              {kind}
            </li>
          ))}
        </ul>
      </Block>

      <Block title={ui.doesTitle}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {page.does.map((line) => (
            <li key={line} className="card p-5">
              {line}
            </li>
          ))}
        </ul>
      </Block>

      <Block title={ui.questionsTitle}>
        <p className="muted">{ui.questionsLead}</p>
        <ul className="flex flex-col items-start gap-2">
          {page.sampleQuestions.map((question) => (
            <li
              key={question}
              className="rounded-[20px] rounded-es-md bg-[var(--accent-soft)] px-4 py-2.5 text-[var(--accent-soft-text)]"
            >
              {question}
            </li>
          ))}
        </ul>
      </Block>

      <Block title={ui.limitsTitle}>
        <p className="card p-5">{page.limits}</p>
      </Block>

      <Block title={ui.featuresTitle}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {page.features.map((feature) => (
            <li key={feature.title.en} className="card flex flex-col gap-2 p-5">
              <h3 className="text-lg font-semibold">{feature.title[lang]}</h3>
              <p className="muted text-sm">{feature.body[lang]}</p>
            </li>
          ))}
        </ul>
      </Block>

      <Block title={ui.faqTitle}>
        <div className="flex flex-col gap-3">
          {page.faqs.map((faq) => (
            <details key={faq.question} className="card portal-faq px-6 py-1">
              <summary className="cursor-pointer list-none py-4 font-medium">{faq.question}</summary>
              <p className="muted pb-5 text-sm">{faq.answer}</p>
            </details>
          ))}
        </div>
      </Block>

      <StartCta lang={lang} />

      <Block title={ui.otherIndustries(city.name[lang])}>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {industries
            .filter((other) => other.slug !== industry.slug)
            .map((other) => (
              <li key={other.slug}>
                <Link
                  href={paths.landing(lang, city.slug, other.slug)}
                  className="underline underline-offset-4"
                >
                  {other.name[lang]}
                </Link>
              </li>
            ))}
        </ul>
        <h3 className="mt-4 text-lg font-semibold">{ui.otherCities}</h3>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {cities
            .filter((other) => other.slug !== city.slug)
            .map((other) => (
              <li key={other.slug}>
                <Link
                  href={paths.landing(lang, other.slug, industry.slug)}
                  className="underline underline-offset-4"
                >
                  {other.name[lang]}
                </Link>
              </li>
            ))}
        </ul>
      </Block>
    </SiteShell>
  );
}
