import { buildCityPage, cities, cityPageLd, getCity, paths, UI } from "@traiblazer/marketing";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/site/JsonLd";
import { Block, Breadcrumbs, SiteShell, StartCta } from "@/components/site/SiteShell";
import { langOr404, pageMetadata, siteConfig } from "@/lib/site";

type Params = Promise<{ lang: string; city: string }>;

async function load(params: Params) {
  const { lang: rawLang, city: citySlug } = await params;
  const lang = langOr404(rawLang);
  const city = getCity(citySlug);
  if (!city) notFound();
  return buildCityPage(lang, city);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = await load(params);
  return pageMetadata({ site: siteConfig(), ...page });
}

/** City page: the place, and a link to the page of each industry there. */
export default async function CityPage({ params }: { params: Params }) {
  const page = await load(params);
  const { lang, city } = page;
  const site = siteConfig();
  const ui = UI[lang];

  return (
    <SiteShell site={site} lang={lang} alternates={page.alternates}>
      <JsonLd data={cityPageLd(site, page, ui.breadcrumbCities)} />

      <section className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-10 pb-6 sm:pt-16">
        <Breadcrumbs
          items={[
            { label: site.brand, href: paths.home() },
            { label: ui.breadcrumbCities, href: paths.cities(lang) },
            { label: city.name[lang] },
          ]}
        />
        <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
          {page.heading}
        </h1>
        {page.lead.map((paragraph) => (
          <p key={paragraph} className="muted text-lg">
            {paragraph}
          </p>
        ))}
      </section>

      <Block title={ui.industriesIn(city.name[lang])}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {page.industries.map(({ industry, path, label }) => (
            <li key={industry.slug}>
              <Link href={path} className="card portal-lift flex h-full flex-col gap-2 p-5">
                <span className="text-lg font-semibold">{label}</span>
                <span className="muted text-sm">{industry.kinds[lang].join(" · ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Block>

      <StartCta lang={lang} />

      <Block title={ui.otherCities}>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {cities
            .filter((other) => other.slug !== city.slug)
            .map((other) => (
              <li key={other.slug}>
                <Link href={paths.city(lang, other.slug)} className="underline underline-offset-4">
                  {other.name[lang]}
                </Link>
              </li>
            ))}
        </ul>
      </Block>
    </SiteShell>
  );
}
