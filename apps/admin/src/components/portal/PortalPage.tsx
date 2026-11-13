"use client";

import type { MessageKey } from "@traiblazer/i18n";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { api, type Language, type PublicPlan } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const STEPS = ["step1", "step2", "step3", "step4"] as const;
const FEATURES = ["grounded", "languages", "web", "photos", "workflows", "insights"] as const;
const FAQ = ["website", "sources", "limit", "businesses", "languages", "test"] as const;

type PlanCatalog = { plans: PublicPlan[]; defaultPlan: string; maxBusinessesPerAccount: number };

/** Public landing page: what the product does, how to use it, and the subscription plans. */
export function PortalPage({ signedIn }: { signedIn: boolean }) {
  const { t, language } = useI18n();
  // The marketing pages exist in English and French.
  const siteLang = language === "fr" ? "fr" : "en";
  const [plans, setPlans] = useState<PlanCatalog | null | "error">(null);
  const [languageCount, setLanguageCount] = useState<number | null>(null);

  useEffect(() => {
    api<PlanCatalog>("/v1/catalog/plans")
      .then(setPlans)
      .catch(() => setPlans("error"));
    api<{ languages: Language[] }>("/v1/catalog/languages")
      .then((d) => setLanguageCount(d.languages.filter((l) => l.tier !== "owner").length))
      .catch(() => setLanguageCount(null));
  }, []);

  return (
    <div className="portal">
      <header className="sticky top-0 z-30 border-b border-transparent bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5 text-lg font-semibold">
            <BrandMark size={32} />
            <span className="max-[380px]:sr-only">{t("app.name")}</span>
          </Link>
          <ul className="hidden items-center gap-1 text-sm font-medium md:flex">
            {(["how", "features", "plans", "faq"] as const).map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="muted rounded-full px-3 py-2 hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  {t(`portal.nav.${id}`)}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <div className="hidden lg:block">
              <LanguageSwitcher />
            </div>
            {signedIn ? (
              <Link href="/dashboard" className="btn">
                {t("portal.nav.dashboard")}
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-text text-sm">
                  {t("auth.signIn")}
                </Link>
                <Link href="/signup" className="btn">
                  {t("portal.plans.choose")}
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-20 sm:pt-20 lg:grid-cols-[1.1fr_1fr]">
          <div className="portal-rise flex flex-col items-start gap-6">
            <span className="badge badge-accent px-3 py-1 text-sm">
              <Spark /> {t("portal.hero.eyebrow")}
            </span>
            <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {t("portal.hero.title1")} <span className="text-gradient">{t("portal.hero.title2")}</span>
            </h1>
            <p className="muted max-w-xl text-lg">{t("portal.hero.subtitle")}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={signedIn ? "/dashboard" : "/signup"} className="btn px-6 py-3 text-base">
                {signedIn ? t("portal.nav.dashboard") : t("portal.hero.start")}
              </Link>
              <a href="#plans" className="btn btn-ghost px-6 py-3 text-base">
                {t("portal.hero.seePlans")}
              </a>
            </div>
            <p className="muted text-sm">{t("portal.hero.note")}</p>
          </div>
          <ChatDemo />
        </section>

        {/* ---------- How it works ---------- */}
        <Section id="how" eyebrow={t("portal.how.eyebrow")} title={t("portal.how.title")}>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step} className="card flex flex-col gap-3 p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] font-semibold text-[var(--accent-soft-text)]">
                  {i + 1}
                </span>
                <h3 className="text-lg font-semibold">{t(`portal.how.${step}.title`)}</h3>
                <p className="muted text-sm">{t(`portal.how.${step}.body`)}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ---------- Features ---------- */}
        <Section id="features" eyebrow={t("portal.features.eyebrow")} title={t("portal.features.title")}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature} className="card portal-lift flex flex-col gap-3 p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl [background:var(--gradient-soft)] text-[var(--accent)]">
                  <FeatureIcon name={feature} />
                </span>
                <h3 className="text-lg font-semibold">{t(`portal.features.${feature}.title`)}</h3>
                <p className="muted text-sm">
                  {feature === "languages"
                    ? t("portal.features.languages.body", { count: languageCount ?? 2 })
                    : t(`portal.features.${feature}.body` as MessageKey)}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---------- Plans ---------- */}
        <Section
          id="plans"
          eyebrow={t("portal.plans.eyebrow")}
          title={t("portal.plans.title")}
          subtitle={t("portal.plans.subtitle")}
        >
          <Plans state={plans} signedIn={signedIn} />
        </Section>

        {/* ---------- FAQ ---------- */}
        <Section id="faq" title={t("portal.faq.title")}>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {FAQ.map((q) => (
              <details key={q} className="card portal-faq group px-6 py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium">
                  {t(`portal.faq.${q}.q`)}
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="muted pb-5 text-sm">
                  {q === "businesses"
                    ? t("portal.faq.businesses.a", {
                        count: typeof plans === "object" && plans ? plans.maxBusinessesPerAccount : 3,
                      })
                    : t(`portal.faq.${q}.a` as MessageKey)}
                </p>
              </details>
            ))}
          </div>
        </Section>

        {/* ---------- Closing call to action ---------- */}
        <section className="mx-auto max-w-6xl px-4 pb-20">
          <div className="portal-cta relative overflow-hidden rounded-[32px] px-6 py-14 text-center sm:px-12">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {t("portal.cta.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-lg opacity-90">{t("portal.cta.body")}</p>
            <Link
              href={signedIn ? "/dashboard" : "/signup"}
              className="mt-8 inline-flex min-h-12 items-center rounded-full bg-[var(--on-gradient)] px-7 font-medium text-[var(--accent)] shadow-[var(--shadow-2)] hover:-translate-y-0.5"
            >
              {signedIn ? t("portal.nav.dashboard") : t("portal.hero.start")}
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] px-4 py-8 text-sm">
        <span className="muted flex items-center gap-2">
          <BrandMark size={24} />
          {t("portal.footer.rights", { year: new Date().getFullYear() })}
        </span>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href={`/${siteLang}/local`}>{t("portal.footer.cities")}</Link>
          <Link href={`/${siteLang}/pricing`}>{t("portal.footer.pricing")}</Link>
          <a href="/llms.txt">{t("portal.footer.forAi")}</a>
        </nav>
        <LanguageSwitcher />
      </footer>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto flex max-w-6xl scroll-mt-20 flex-col gap-10 px-4 py-16 sm:py-20">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
        {eyebrow && <span className="eyebrow text-gradient">{eyebrow}</span>}
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
        {subtitle && <p className="muted text-lg">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Plans({ state, signedIn }: { state: PlanCatalog | null | "error"; signedIn: boolean }) {
  const { t, language } = useI18n();
  if (state === null) return <p className="muted text-center">{t("common.loading")}</p>;
  if (state === "error" || state.plans.length === 0) {
    return <p className="muted text-center">{t("portal.plans.unavailable")}</p>;
  }

  const price = (cents: number) =>
    new Intl.NumberFormat(language, {
      style: "currency",
      currency: "CAD",
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);

  return (
    <div className="flex flex-col gap-6">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {state.plans.map((plan) => {
          const featured = plan.id === state.defaultPlan;
          return (
            <li
              key={plan.id}
              className={`card portal-lift flex flex-col gap-5 p-6 ${featured ? "portal-featured" : ""}`}
            >
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">{language === "fr" ? plan.nameFr : plan.nameEn}</h3>
                  {featured && <span className="badge badge-accent">{t("portal.plans.startHere")}</span>}
                </div>
                <p className="flex items-baseline gap-1">
                  {plan.priceMonthlyCents === null ? (
                    <span className="text-2xl font-semibold">{t("portal.plans.custom")}</span>
                  ) : plan.priceMonthlyCents === 0 ? (
                    <span className="text-4xl font-semibold tracking-tight">{t("portal.plans.free")}</span>
                  ) : (
                    <>
                      <span className="text-4xl font-semibold tracking-tight">
                        {price(plan.priceMonthlyCents)}
                      </span>
                      <span className="muted text-sm">{t("portal.plans.perMonth")}</span>
                    </>
                  )}
                </p>
              </div>
              <ul className="flex flex-1 flex-col gap-2.5 text-sm">
                <PlanLine strong>{t("portal.plans.questions", { count: plan.monthlyQuestions })}</PlanLine>
                <PlanLine>{t("portal.plans.perMinute", { count: plan.perMinute })}</PlanLine>
                <PlanLine>{t("portal.plans.concurrent", { count: plan.concurrent })}</PlanLine>
                <PlanLine>{t("portal.plans.photos", { count: plan.knowledgeImages })}</PlanLine>
                <PlanLine>{t("portal.plans.everything")}</PlanLine>
              </ul>
              <Link
                href={signedIn ? "/dashboard" : "/signup"}
                className={`btn w-full ${featured ? "" : "btn-ghost"}`}
              >
                {signedIn ? t("portal.nav.dashboard") : t("portal.plans.choose")}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="muted flex flex-col items-center gap-1 text-center text-sm">
        <p>{t("portal.plans.businesses", { count: state.maxBusinessesPerAccount })}</p>
        <p>{t("portal.plans.currency")}</p>
      </div>
    </div>
  );
}

function PlanLine({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <li className={`flex items-start gap-2.5 ${strong ? "font-medium" : ""}`}>
      <svg
        className="mt-0.5 shrink-0 text-[var(--accent)]"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/** A static, illustrative conversation (not a live chat). */
function ChatDemo() {
  const { t } = useI18n();
  return (
    <div className="portal-rise portal-rise-delay relative mx-auto w-full max-w-md" aria-hidden="true">
      <div className="portal-glow" />
      <div className="card relative flex flex-col overflow-hidden shadow-[var(--shadow-2)]">
        <div className="flex items-center gap-3 px-5 py-4 text-[var(--on-gradient)] [background:var(--gradient)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/25 text-sm font-semibold">
            LB
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-semibold">{t("portal.demo.title")}</span>
            <span className="text-xs opacity-85">{t("portal.demo.online")}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 p-5 text-sm">
          <Bubble user>{t("portal.demo.q1")}</Bubble>
          <Bubble>{t("portal.demo.a1")}</Bubble>
          <Bubble user>{t("portal.demo.q2")}</Bubble>
          <Bubble>
            {t("portal.demo.a2")}
            <span className="mt-2 flex h-24 w-40 items-end rounded-2xl bg-[linear-gradient(135deg,#7fb3a2,#e9c46a_60%,#e76f51)] p-2 text-xs font-semibold text-white">
              {t("portal.demo.photo")}
            </span>
          </Bubble>
        </div>
        <div className="mx-5 mb-5 flex items-center justify-between rounded-full bg-[var(--surface-2)] px-4 py-2.5 text-sm">
          <span className="muted">…</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--on-gradient)] [background:var(--gradient)]">
            ↑
          </span>
        </div>
      </div>
    </div>
  );
}

function Bubble({ children, user }: { children: ReactNode; user?: boolean }) {
  return (
    <div
      className={`max-w-[85%] rounded-[20px] px-4 py-2.5 ${
        user
          ? "self-end rounded-ee-md bg-[var(--accent-soft)] text-[var(--accent-soft-text)]"
          : "self-start rounded-es-md bg-[var(--surface-2)]"
      }`}
    >
      {children}
    </div>
  );
}

function Spark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c.4 4.9 2.6 8.6 10 10-7.4 1.4-9.6 5.1-10 10-.4-4.9-2.6-8.6-10-10 7.4-1.4 9.6-5.1 10-10Z" />
    </svg>
  );
}

const ICONS: Record<(typeof FEATURES)[number], ReactNode> = {
  grounded: (
    <>
      <path d="M12 3 4 6v6c0 4.4 3.4 8.4 8 9 4.6-.6 8-4.6 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  languages: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
    </>
  ),
  web: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
    </>
  ),
  photos: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </>
  ),
  workflows: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5" />
    </>
  ),
  insights: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
};

function FeatureIcon({ name }: { name: (typeof FEATURES)[number] }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
