import type { TriageRules } from "@traiblazer/industry-packs";

/**
 * Triage of a visitor's message (PLAN §4.2 "Urgent request flag", "Safety & escalation"):
 *
 *   danger   a danger to life or a home right now (gas, carbon monoxide, fire). Platform rule for
 *            every industry: leave, call 911, then the business.
 *   urgent   a problem that can't wait, by the industry's own words (burst pipe, no heat, a car
 *            broken down).
 *
 * Two layers decide it: these keyword rules (English and French, instant, no model needed) and the
 * auxiliary model's reading of the message (any language; see `parseTriage`). The higher wins.
 */
export type Urgency = "urgent" | "danger";

/** Platform danger words, for every business. Whole words, compared without case or accents. */
const DANGER: Record<"en" | "fr", string[]> = {
  en: [
    "smell gas",
    "smell of gas",
    "smells like gas",
    "smelling gas",
    "gas smell",
    "gas leak",
    "leaking gas",
    "carbon monoxide",
    "co alarm",
    "co detector",
    "co detector going off",
    "house fire",
    "on fire",
    "caught fire",
    "electrical fire",
    "flames",
    "smoke coming",
    "smoke from",
    "smell smoke",
    "smell burning",
    "burning smell",
    "sparks",
    "sparking",
    "electrocuted",
    "got a shock",
  ],
  fr: [
    "odeur de gaz",
    "sent le gaz",
    "senteur de gaz",
    "fuite de gaz",
    "monoxyde de carbone",
    "alarme de monoxyde",
    "detecteur de monoxyde",
    "en feu",
    "un incendie",
    "incendie",
    "des flammes",
    "de la fumee",
    "fumee qui sort",
    "odeur de brule",
    "etincelles",
    "electrocute",
  ],
};

/** Lowercase, no accents, straight apostrophes, words separated by single spaces. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

function matchesAny(normalized: string, phrases: string[]): boolean {
  const padded = ` ${normalized} `;
  return phrases.some((phrase) => {
    const p = normalizeForMatch(phrase);
    return p.length > 0 && padded.includes(` ${p} `);
  });
}

/** The keyword rules' reading of one message, or null when nothing matched. */
export function keywordTriage(text: string, rules: TriageRules): Urgency | null {
  const normalized = normalizeForMatch(text);
  if (!normalized) return null;
  if (matchesAny(normalized, [...DANGER.en, ...DANGER.fr])) return "danger";
  if (matchesAny(normalized, [...rules.urgent.en, ...rules.urgent.fr])) return "urgent";
  return null;
}

const RANK = { urgent: 1, danger: 2 } as const;

/** The more serious of two readings. */
export function higherUrgency(a: Urgency | null, b: Urgency | null): Urgency | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/** What the auxiliary model said about the message (see `buildSearchQueryPrompt`). */
export interface ModelTriage {
  urgency: Urgency | null;
  /** The visitor asks for a diagnosis, a safety judgement or professional advice. */
  advice: boolean;
}

/** Reads the `TYPE:` line of the auxiliary model's reply; anything unclear is routine. */
export function parseTriage(output: string): ModelTriage {
  const line = output.split("\n").find((l) => /^\s*TYPE\s*:/i.test(l));
  const value =
    line
      ?.replace(/^\s*TYPE\s*:\s*/i, "")
      .trim()
      .toLowerCase() ?? "";
  const word = /^[a-z]+/.exec(value)?.[0];
  if (word === "danger") return { urgency: "danger", advice: false };
  if (word === "urgent") return { urgency: "urgent", advice: false };
  if (word === "advice") return { urgency: null, advice: true };
  return { urgency: null, advice: false };
}
