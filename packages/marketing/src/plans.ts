import type { Lang } from "./site.js";

/**
 * A plan as the API publishes it (`GET /v1/catalog/plans`): the active plans operators keep in the
 * operator console. Prices are never written in this package; every page, llms.txt and the MCP
 * server read them from there, so they always agree.
 */
export interface PublicPlan {
  id: string;
  nameEn: string;
  nameFr: string;
  monthlyQuestions: number;
  perMinute: number;
  concurrent: number;
  knowledgeImages: number;
  /** Monthly price in cents (CAD); null means "contact us". */
  priceMonthlyCents: number | null;
}

export const PRICE_CURRENCY = "CAD";

export function planName(plan: PublicPlan, lang: Lang): string {
  return lang === "fr" ? plan.nameFr : plan.nameEn;
}

/** "$39" / "39 $", with cents only when there are any. */
export function formatPrice(cents: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: PRICE_CURRENCY,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

const number = (n: number, lang: Lang) => new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA").format(n);

const TEXT = {
  en: {
    free: "Free",
    contact: "Contact us",
    perMonth: "per month",
    questions: (n: string) => `${n} visitor questions answered per month`,
    perMinute: (n: string) => `up to ${n} questions per minute`,
    concurrent: (n: number) => (n === 1 ? "1 answer at a time" : `${n} answers at the same time`),
    photos: (n: string) => `${n} photos per assistant`,
  },
  fr: {
    free: "Gratuit",
    contact: "Contactez-nous",
    perMonth: "par mois",
    questions: (n: string) => `${n} questions de visiteurs par mois`,
    perMinute: (n: string) => `jusqu'à ${n} questions par minute`,
    concurrent: (n: number) => (n === 1 ? "1 réponse à la fois" : `${n} réponses en même temps`),
    photos: (n: string) => `${n} photos par assistant`,
  },
} as const;

/** The price as people read it: "Free", "$39 per month" or "Contact us". */
export function priceLabel(plan: PublicPlan, lang: Lang): string {
  const text = TEXT[lang];
  if (plan.priceMonthlyCents === null) return text.contact;
  if (plan.priceMonthlyCents === 0) return text.free;
  return `${formatPrice(plan.priceMonthlyCents, lang)} ${text.perMonth}`;
}

/** What the plan includes, one item per line. */
export function planIncludes(plan: PublicPlan, lang: Lang): string[] {
  const text = TEXT[lang];
  return [
    text.questions(number(plan.monthlyQuestions, lang)),
    text.perMinute(number(plan.perMinute, lang)),
    text.concurrent(plan.concurrent),
    text.photos(number(plan.knowledgeImages, lang)),
  ];
}

/** A plan as plain data for machines (the MCP server). */
export function planFacts(plan: PublicPlan) {
  return {
    id: plan.id,
    name: { en: plan.nameEn, fr: plan.nameFr },
    priceMonthly: plan.priceMonthlyCents === null ? null : plan.priceMonthlyCents / 100,
    currency: PRICE_CURRENCY,
    priceNote:
      plan.priceMonthlyCents === null
        ? "Price on request"
        : plan.priceMonthlyCents === 0
          ? "Free"
          : "Per month, before taxes",
    monthlyQuestions: plan.monthlyQuestions,
    questionsPerMinute: plan.perMinute,
    concurrentAnswers: plan.concurrent,
    photosPerAssistant: plan.knowledgeImages,
  };
}
