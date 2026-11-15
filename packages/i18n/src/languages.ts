/**
 * Language registry (see docs/PLAN.md §6).
 *
 * Tiers:
 *  1 — full support: UI, human-reviewed templates and safety messages, eval sets
 *  2 — priority newcomer languages: visitor answers, translated widget UI, reviewed safety messages
 *  3 — best effort: the LLM answers in the visitor's language; UI falls back to English
 *  owner — owner-provided phrases only (e.g. Indigenous languages), then hand off to a human
 *
 * Promoting a language = changing its tier here (plus adding UI strings), not code.
 */
export type LanguageTier = 1 | 2 | 3 | "owner";
export type TextDirection = "ltr" | "rtl";

export interface Language {
  /** BCP 47 code. */
  code: string;
  englishName: string;
  nativeName: string;
  tier: LanguageTier;
  script: string;
  dir: TextDirection;
}

export const languages = [
  // Tier 1
  { code: "en", englishName: "English", nativeName: "English", tier: 1, script: "Latn", dir: "ltr" },
  { code: "fr", englishName: "French", nativeName: "Français", tier: 1, script: "Latn", dir: "ltr" },

  // Tier 2 — priority newcomer languages
  {
    code: "zh-Hans",
    englishName: "Chinese (Simplified)",
    nativeName: "简体中文",
    tier: 2,
    script: "Hans",
    dir: "ltr",
  },
  {
    code: "zh-Hant",
    englishName: "Chinese (Traditional)",
    nativeName: "繁體中文",
    tier: 2,
    script: "Hant",
    dir: "ltr",
  },
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी", tier: 2, script: "Deva", dir: "ltr" },
  { code: "pa", englishName: "Punjabi", nativeName: "ਪੰਜਾਬੀ", tier: 2, script: "Guru", dir: "ltr" },
  { code: "ur", englishName: "Urdu", nativeName: "اردو", tier: 2, script: "Arab", dir: "rtl" },
  { code: "ar", englishName: "Arabic", nativeName: "العربية", tier: 2, script: "Arab", dir: "rtl" },
  { code: "fa", englishName: "Persian (Farsi)", nativeName: "فارسی", tier: 2, script: "Arab", dir: "rtl" },
  { code: "uk", englishName: "Ukrainian", nativeName: "Українська", tier: 2, script: "Cyrl", dir: "ltr" },
  {
    code: "tl",
    englishName: "Tagalog (Filipino)",
    nativeName: "Tagalog",
    tier: 2,
    script: "Latn",
    dir: "ltr",
  },
  { code: "es", englishName: "Spanish", nativeName: "Español", tier: 2, script: "Latn", dir: "ltr" },

  // Tier 3 — best effort
  { code: "gu", englishName: "Gujarati", nativeName: "ગુજરાતી", tier: 3, script: "Gujr", dir: "ltr" },
  { code: "ta", englishName: "Tamil", nativeName: "தமிழ்", tier: 3, script: "Taml", dir: "ltr" },
  { code: "te", englishName: "Telugu", nativeName: "తెలుగు", tier: 3, script: "Telu", dir: "ltr" },
  { code: "ml", englishName: "Malayalam", nativeName: "മലയാളം", tier: 3, script: "Mlym", dir: "ltr" },
  { code: "bn", englishName: "Bengali", nativeName: "বাংলা", tier: 3, script: "Beng", dir: "ltr" },
  { code: "ru", englishName: "Russian", nativeName: "Русский", tier: 3, script: "Cyrl", dir: "ltr" },
  { code: "tr", englishName: "Turkish", nativeName: "Türkçe", tier: 3, script: "Latn", dir: "ltr" },
  { code: "vi", englishName: "Vietnamese", nativeName: "Tiếng Việt", tier: 3, script: "Latn", dir: "ltr" },
  { code: "ko", englishName: "Korean", nativeName: "한국어", tier: 3, script: "Kore", dir: "ltr" },
  { code: "pt", englishName: "Portuguese", nativeName: "Português", tier: 3, script: "Latn", dir: "ltr" },

  // Owner-provided phrases
  {
    code: "oj",
    englishName: "Ojibwe (Anishinaabemowin)",
    nativeName: "Anishinaabemowin",
    tier: "owner",
    script: "Latn",
    dir: "ltr",
  },
  {
    code: "ojs",
    englishName: "Oji-Cree",
    nativeName: "Anishininiimowin",
    tier: "owner",
    script: "Cans",
    dir: "ltr",
  },
  { code: "cr", englishName: "Cree", nativeName: "ᓀᐦᐃᔭᐍᐏᐣ", tier: "owner", script: "Cans", dir: "ltr" },
] as const satisfies readonly Language[];

export type LanguageCode = (typeof languages)[number]["code"];

const byCode = new Map<string, Language>(languages.map((l) => [l.code.toLowerCase(), l]));

export function getLanguage(code: string): Language | undefined {
  return byCode.get(code.toLowerCase());
}

export function isSupportedLanguage(code: string): code is LanguageCode {
  return byCode.has(code.toLowerCase());
}

export function getDirection(code: string): TextDirection {
  return getLanguage(code)?.dir ?? "ltr";
}

/**
 * Maps any BCP 47 tag to a registry code: "fr-CA" → "fr", "zh-CN" → "zh-Hans", "zh-TW" → "zh-Hant",
 * "pa-Guru-IN" → "pa". Returns undefined for languages not in the registry.
 */
export function normalizeLanguageTag(tag: string): LanguageCode | undefined {
  const raw = tag.trim();
  if (!raw) return undefined;
  const direct = getLanguage(raw);
  if (direct) return direct.code as LanguageCode;

  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(raw).maximize();
  } catch {
    return undefined;
  }
  if (locale.language === "zh") {
    return locale.script === "Hant" ? "zh-Hant" : "zh-Hans";
  }
  if (locale.language === "fil") return "tl";
  const base = getLanguage(locale.language);
  return base ? (base.code as LanguageCode) : undefined;
}

/**
 * Picks the best supported language from an Accept-Language header, limited to `allowed`.
 * Falls back to `fallback` (default "en").
 */
export function negotiateLanguage(
  acceptLanguage: string | null | undefined,
  allowed: readonly string[],
  fallback = "en",
): string {
  if (!acceptLanguage) return fallback;
  const allowedSet = new Set(allowed.map((a) => a.toLowerCase()));
  const candidates = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim(), q: q ? Number.parseFloat(q.trim().slice(2)) : 1, index };
    })
    .filter((c) => c.tag && c.tag !== "*" && !Number.isNaN(c.q) && c.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const candidate of candidates) {
    const code = normalizeLanguageTag(candidate.tag);
    if (code && allowedSet.has(code.toLowerCase())) {
      return allowed.find((a) => a.toLowerCase() === code.toLowerCase()) ?? code;
    }
  }
  return fallback;
}

/** The two languages the platform's own text is written in. */
export type EnOrFr = "en" | "fr";

/** French for "fr", English for anything else (other languages, or none set). */
export const enOrFr = (code: string | null | undefined): EnOrFr => (code === "fr" ? "fr" : "en");
