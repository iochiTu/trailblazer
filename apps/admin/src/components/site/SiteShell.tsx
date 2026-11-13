import { formatAddress, type Lang, paths, type SiteConfig, UI } from "@traiblazer/marketing";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";

/**
 * Header and footer of the public marketing pages. Rendered on the server with plain links, so the
 * pages read the same with or without JavaScript.
 */
export function SiteShell({
  site,
  lang,
  alternates,
  children,
}: {
  site: SiteConfig;
  lang: Lang;
  /** This page in each language, for the language link. */
  alternates: Record<Lang, string>;
  children: ReactNode;
}) {
  const ui = UI[lang];
  const other: Lang = lang === "en" ? "fr" : "en";
  const contact = [ui.footerNote, site.address ? formatAddress(site.address) : null, site.phone, site.email]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="portal">
      <header className="sticky top-0 z-30 bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href={paths.home()} className="flex items-center gap-2.5 text-lg font-semibold">
            <BrandMark size={32} />
            <span className="max-[380px]:sr-only">{site.brand}</span>
          </Link>
          <ul className="hidden items-center gap-1 text-sm font-medium md:flex">
            <li>
              <Link
                href={paths.cities(lang)}
                className="muted rounded-full px-3 py-2 hover:text-[var(--text)]"
              >
                {ui.nav.cities}
              </Link>
            </li>
            <li>
              <Link
                href={paths.pricing(lang)}
                className="muted rounded-full px-3 py-2 hover:text-[var(--text)]"
              >
                {ui.nav.pricing}
              </Link>
            </li>
          </ul>
          <div className="flex items-center gap-2">
            <a href={alternates[other]} hrefLang={other} lang={other} className="btn-text text-sm">
              {ui.otherLanguage}
            </a>
            <Link href="/login" className="btn-text hidden text-sm sm:inline-flex">
              {ui.nav.signIn}
            </Link>
            <Link href={paths.signup()} className="btn">
              {ui.nav.start}
            </Link>
          </div>
        </nav>
      </header>

      <main>{children}</main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-[var(--border)] px-4 py-8 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="muted flex items-center gap-2">
            <BrandMark size={24} />© {new Date().getFullYear()} {site.legalName ?? site.brand}
          </span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href={paths.home()}>{ui.nav.home}</Link>
            <Link href={paths.cities(lang)}>{ui.nav.cities}</Link>
            <Link href={paths.pricing(lang)}>{ui.nav.pricing}</Link>
            <a href={paths.llms()}>{ui.forAi}</a>
          </nav>
        </div>
        <p className="muted">{contact}</p>
      </footer>
    </div>
  );
}

/** A titled block of page content. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-10">
      <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

/** Small trail of links back up the site ("Traiblazer / Cities / Thunder Bay"). */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="muted text-sm">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-[var(--text)]">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The closing call to action shared by every marketing page. */
export function StartCta({ lang }: { lang: Lang }) {
  const ui = UI[lang];
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <div className="portal-cta relative overflow-hidden rounded-[32px] px-6 py-12 text-center sm:px-12">
        <h2 className="text-3xl font-semibold tracking-tight text-balance">{ui.ctaTitle}</h2>
        <p className="mx-auto mt-3 max-w-xl text-lg opacity-90">{ui.ctaBody}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href={paths.signup()}
            className="inline-flex min-h-12 items-center rounded-full bg-[var(--on-gradient)] px-7 font-medium text-[var(--accent)] shadow-[var(--shadow-2)]"
          >
            {ui.nav.start}
          </Link>
          <Link href={paths.pricing(lang)} className="font-medium underline underline-offset-4">
            {ui.seePricing}
          </Link>
        </div>
      </div>
    </section>
  );
}
