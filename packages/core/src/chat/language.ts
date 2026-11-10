/**
 * Lightweight language guess from the visitor's text (script + a few cues). It only decides
 * whether query translation is needed and what to log; the model itself replies in the visitor's
 * language.
 */
export function guessLanguage(text: string): string | null {
  const t = text.normalize("NFC");
  if (/[਀-੿]/.test(t)) return "pa";
  if (/[ऀ-ॿ]/.test(t)) return "hi";
  if (/[઀-૿]/.test(t)) return "gu";
  if (/[஀-௿]/.test(t)) return "ta";
  if (/[ఀ-౿]/.test(t)) return "te";
  if (/[ഀ-ൿ]/.test(t)) return "ml";
  if (/[ঀ-৿]/.test(t)) return "bn";
  if (/[가-힯]/.test(t)) return "ko";
  if (/[؀-ۿ]/.test(t)) {
    if (/[ٹڈڑںےھ]/.test(t)) return "ur";
    if (/[پچژگی]/.test(t)) return "fa";
    return "ar";
  }
  if (/[一-鿿]/.test(t)) return /[們這個麼來時點開門營業價錢]/.test(t) ? "zh-Hant" : "zh-Hans";
  if (/[Ѐ-ӿ]/.test(t)) return /[іїєґІЇЄҐ]/.test(t) ? "uk" : "ru";

  // Punctuation next to a word ("Bonjour, …") must not hide the word.
  const lower = ` ${t.toLowerCase().replace(/[.,;:!?…«»"()]/g, " ")} `;
  const words = (list: string[]) =>
    list.filter((w) => lower.includes(` ${w} `) || lower.includes(` ${w}?`)).length;
  if (/[ăơưđ]|[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/.test(lower)) return "vi";
  if (/[ğış]/.test(lower)) return "tr";
  if (/[ñ¿¡]/.test(lower) || words(["hola", "gracias", "usted", "cuánto", "dónde", "horario", "tienen"]) >= 1)
    return "es";
  if (/[ãõ]/.test(lower) || words(["obrigado", "obrigada", "você", "vocês"]) >= 1) return "pt";
  if (words(["po", "salamat", "ano", "kailan", "magkano", "saan", "ba", "kayo"]) >= 2) return "tl";
  const frenchCues = words([
    "bonjour",
    "merci",
    "vous",
    "est-ce",
    "quelle",
    "quel",
    "quels",
    "êtes",
    "avez",
    "je",
    "nous",
    "pour",
    "le",
    "la",
    "les",
    "des",
    "à",
  ]);
  if (/[éèêëàâçùûôîœ]/.test(lower) ? frenchCues >= 1 : frenchCues >= 2) return "fr";
  if (/[a-z]/.test(lower)) return "en";
  return null;
}

/** True when keyword search over EN/FR content will work without translating the question. */
export function isEnOrFr(language: string | null): boolean {
  return language === "en" || language === "fr";
}
