import { messages, type Tx } from "@traiblazer/db";
import { and, eq } from "drizzle-orm";
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

/** The visitor's email address and phone number as a request tool passes them on. */
export interface VisitorContact {
  email: string | null;
  phone: string | null;
  /** The phone is the number the visitor is texting from. */
  ownNumber: boolean;
}

/**
 * The visitor's email and phone from a request tool's input, tidied and checked the same way for
 * every request; or what to tell the model when one is missing or incomplete. `missing` and
 * `retry` (the end of the other messages) are the tool's own wording.
 */
export function readContact(
  input: { email?: string | null; phone?: string | null },
  visitorPhone: string | null | undefined,
  wording: { missing: string; retry: string },
): VisitorContact | { error: string } {
  // Without an "@" or a digit it isn't an attempt at an address or number: treat as not given.
  const rawEmail = clean(input.email);
  const email = rawEmail?.includes("@") ? rawEmail.toLowerCase() : null;
  const rawPhone = clean(input.phone);
  // By text message, the number the customer writes from stands in when they gave no other.
  const phone = rawPhone && /\d/.test(rawPhone) ? rawPhone : (visitorPhone ?? null);
  if (!email && !phone) return { error: wording.missing };
  if (email && !emailSchema.safeParse(email).success) {
    return {
      error: `"${email}" isn't a complete email address. Ask the visitor to check it${wording.retry}.`,
    };
  }
  if (phone && digits(phone).length < 7) {
    return {
      error: `"${phone}" isn't a complete phone number. Ask the visitor to check it${wording.retry}.`,
    };
  }
  const ownNumber = Boolean(phone && visitorPhone && digits(visitorPhone).endsWith(digits(phone).slice(-10)));
  return { email, phone, ownNumber };
}

/**
 * What to tell the model when the visitor didn't type one of these details in the conversation
 * (the number they text from needs no typing); null when every detail is theirs.
 */
export async function untypedContact(
  tx: Tx,
  conversationId: string,
  contact: VisitorContact,
): Promise<string | null> {
  const visitorText = (
    await tx
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user")))
  ).map((m) => m.content);
  const { email, phone, ownNumber } = contact;
  for (const detail of [email && { email }, phone && !ownNumber && { phone }]) {
    if (detail && !typedByVisitor(detail, visitorText)) {
      const value = "email" in detail ? detail.email : detail.phone;
      return `The visitor didn't type "${value}" in this conversation. Ask them for their ${"email" in detail ? "email address" : "phone number"} and use exactly what they write.`;
    }
  }
  return null;
}
