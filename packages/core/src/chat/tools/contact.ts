import { z } from "zod";

/** Contact details a visitor gives the assistant: tidying them, and checking the visitor typed them. */

export const emailSchema = z.email().max(254);
export const digits = (text: string) => text.replace(/\D/g, "");
/**
 * What models write in a field they have nothing for ("null", "N/A", "none", "aucun"…), instead
 * of leaving it out. Compared lower case, without accents or a final full stop.
 */
const PLACEHOLDERS = new Set([
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "nil",
  "unknown",
  "not provided",
  "not given",
  "not specified",
  "-",
  "--",
  "?",
  "aucun",
  "aucune",
  "non fourni",
  "non precise",
  "inconnu",
  "s.o",
  "sans objet",
]);

/** The value with spaces tidied; null when empty or a placeholder for "nothing". */
export const clean = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const key = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  return PLACEHOLDERS.has(key) ? null : text;
};

/**
 * True when the visitor typed this contact detail themselves in the conversation. Contact details
 * are personal data a business will act on, so the assistant can pass on only what the visitor
 * wrote: never a guess, and never an address or number picked up from the business's own pages.
 */
export function typedByVisitor(
  detail: { email?: string | null; phone?: string | null },
  visitorText: string[],
) {
  if (detail.email) {
    const email = detail.email.toLowerCase();
    return visitorText.some((text) => text.toLowerCase().includes(email));
  }
  const number = digits(detail.phone ?? "");
  // A country code the visitor left out ("+1") is fine: the last ten digits must be theirs.
  const local = number.length > 10 ? number.slice(-10) : number;
  return visitorText.some((text) => digits(text).includes(local));
}
