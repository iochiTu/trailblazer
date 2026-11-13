/**
 * Words a customer texts to control messages from a number, before any answer is written
 * (docs/PHONE_AND_SMS.md §4.2). English and French; the carrier's own list is longer.
 */
const STOP = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "arret", "arreter"]);
const START = new Set(["start", "unstop", "debut", "commencer"]);
const HELP = new Set(["help", "info", "aide"]);

export type SmsKeyword = "stop" | "start" | "help";

/** The keyword a text consists of (one word, case and accents ignored), or null for a real message. */
export function smsKeyword(text: string): SmsKeyword | null {
  const word = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  if (STOP.has(word)) return "stop";
  if (START.has(word)) return "start";
  if (HELP.has(word)) return "help";
  return null;
}

/** Characters every phone shows in the 7-bit alphabet (GSM 03.38); anything else makes the text Unicode. */
const GSM =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_DOUBLE = "^{}\\[~]|€\f";

/** How many message parts the carrier bills a text as (160 or 70 characters; 153 or 67 when joined). */
export function smsSegments(text: string): number {
  let units = 0;
  let unicode = false;
  for (const char of text) {
    if (GSM.includes(char)) units += 1;
    else if (GSM_DOUBLE.includes(char)) units += 2;
    else {
      unicode = true;
      break;
    }
  }
  if (unicode) {
    const length = text.length; // UTF-16 units, as carriers count them
    return length <= 70 ? 1 : Math.ceil(length / 67);
  }
  return units <= 160 ? 1 : Math.ceil(units / 153);
}

/** Longest text sent as one message; longer replies are cut at a sentence end. */
export const SMS_MAX_CHARS = 1200;

/**
 * A chat reply as a text message: no Markdown, no blank runs, at most SMS_MAX_CHARS (cut at the last
 * sentence end that fits).
 */
export function toSmsText(reply: string, max = SMS_MAX_CHARS): string {
  let text = reply
    // Typographic characters aren't in the 7-bit alphabet: one of them makes the whole text cost
    // more than twice as many parts.
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\s*\u2014\s*/g, " - ")
    .replace(/[\u2010-\u2013\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F\u2009]/g, " ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/^[ \t]*[-*•][ \t]+/gm, "- ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("\n"),
  );
  text = (end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1).trimEnd()}…`).trim();
  return text;
}
