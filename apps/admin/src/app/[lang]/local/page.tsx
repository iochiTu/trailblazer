import { alternates, cities, industries, paths, SERVICE_AREA, UI } from "@traiblazer/marketing";
import type { Metadata } from "next";
import Link from "next/link";
import { Block, SiteShell, StartCta } from "@/components/site/SiteShell";
import { langOr404, pageMetadata, siteConfig } from "@/lib/site";

type Params = Promise<{ lang: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const lang = langOr404((await params).lang);
  return pageMetadata({
    site: siteConfig(),
    lang,
    title: `${UI[lang].citiesTitle} | Traiblazer`,
    description: SERVICE_AREA[lang],
    alternates: alternates(paths.cities),
  });
}

/** Index of every city with local pages. */
export default async function CitiesPage({ params }: { params: Params }) {
  const lang = langOr404((await params).lang);
  const site = siteConfig();
  const ui = UI[lang];

  return (
    <SiteShell site={site} lang={lang} alternates={alternates(paths.cities)}>
      <section className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-10 pb-2 sm:pt-16">
        <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
          {ui.citiesTitle}
        </h1>
        <p className="muted text-lg">{SERVICE_AREA[lang]}</p>
      </section>

      <Block title={ui.citiesLead}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {cities.map((city) => (
            <li key={city.slug} className="card flex flex-col gap-3 p-5">
              <Link
                href={paths.city(lang, city.slug)}
                className="text-lg font-semibold underline-offset-4 hover:underline"
              >
                {city.name[lang]}
              </Link>
              <p className="muted text-sm">{city.about[lang]}</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {industries.map((industry) => (
                  <li key={industry.slug}>
                    <Link
                      href={paths.landing(lang, city.slug, industry.slug)}
                      className="underline underline-offset-4"
                    >
                      {industry.name[lang]}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Block>

      <StartCta lang={lang} />
    </SiteShell>
  );
}
