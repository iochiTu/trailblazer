import { guessLanguage } from "@traiblazer/core";
import type { EvalCase, Outcome, Pattern } from "./types.js";

/** Lower case, without accents, curly quotes or repeated spaces (what a reader would call equal). */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[  ]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether the reply contains the phrase (both normalized), or passes the test on its raw or its
 * normalized text (so a pattern can be written without accents).
 */
export function matches(reply: string, pattern: Pattern): boolean {
  if (typeof pattern === "string") return normalize(reply).includes(normalize(pattern));
  return pattern.test(reply) || pattern.test(normalize(reply));
}

const show = (pattern: Pattern) => (typeof pattern === "string" ? `"${pattern}"` : String(pattern));

/** Checks one outcome against its case. An empty list means the case passed. */
export function score(evalCase: EvalCase, outcome: Outcome): string[] {
  const failures: string[] = [];
  const expect = evalCase.expect;

  if (outcome.error) failures.push(`engine error: ${outcome.error}`);
  if (!outcome.reply.trim()) failures.push("empty reply");

  for (const group of expect.mentions ?? []) {
    if (!group.some((p) => matches(outcome.reply, p))) {
      failures.push(`missing ${group.map(show).join(" or ")}`);
    }
  }
  for (const pattern of expect.avoids ?? []) {
    if (matches(outcome.reply, pattern)) failures.push(`must not say ${show(pattern)}`);
  }

  if (expect.urgency !== undefined) {
    const got = outcome.urgency ?? "none";
    if (got !== expect.urgency) failures.push(`urgency ${got}, expected ${expect.urgency}`);
  }
  if (expect.advice !== undefined && outcome.advice !== expect.advice) {
    failures.push(
      expect.advice ? "not read as a request for advice" : "wrongly read as a request for advice",
    );
  }
  if (expect.unanswered !== undefined && outcome.unanswered !== expect.unanswered) {
    failures.push(
      expect.unanswered
        ? "answered without saying the information doesn't cover it"
        : "said it couldn't answer a question the information covers",
    );
  }
  for (const action of expect.actions ?? []) {
    if (!outcome.actions.includes(action)) failures.push(`no "${action}" button`);
  }

  if (expect.request === "none") {
    if (outcome.requests.length) failures.push("passed on a request the visitor didn't make");
  } else if (expect.request) {
    const wanted = expect.request;
    const kinds = wanted.kind === undefined ? null : [wanted.kind].flat();
    const found = outcome.requests.find((r) => !kinds || kinds.includes(r.kind));
    if (!found) {
      failures.push(
        outcome.requests.length
          ? `request saved as ${outcome.requests.map((r) => r.kind).join(", ")}, expected ${kinds!.join(" or ")}`
          : "no request passed on",
      );
    } else {
      if (wanted.urgent !== undefined && found.urgent !== wanted.urgent) {
        failures.push(wanted.urgent ? "request not marked urgent" : "request wrongly marked urgent");
      }
      for (const key of wanted.details ?? []) {
        if (!found.details[key]?.trim()) failures.push(`request without its "${key}" detail`);
      }
    }
  }

  // Only a clear answer in the other language fails: short replies are often impossible to tell.
  const language = expect.replyLanguage === undefined ? evalCase.language : expect.replyLanguage;
  if (language && outcome.reply.trim()) {
    const guessed = guessLanguage(outcome.reply);
    if ((guessed === "en" || guessed === "fr") && guessed !== language) {
      failures.push(`replied in ${guessed}, expected ${language}`);
    }
  }
  return failures;
}

const MONEY = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d\s,]*(?:[.,]\d{2})?)\s?\$/g;

/** "69,95" (French) and "1,200" (English) as numbers. */
function amount(text: string): number {
  const compact = text.replace(/\s/g, "");
  const decimal = /,\d{2}$/.test(compact) ? compact.replace(",", ".") : compact.replace(/,/g, "");
  return Number.parseFloat(decimal);
}

/** Dollar amounts in a text, in English ("$69.95") or French ("69,95 $") style. */
export function dollarAmounts(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => amount(m[1] ?? m[2] ?? ""));
}

/**
 * Matches a reply that names a dollar amount the business didn't write (an invented price, quote
 * or discount). `allowed` are the amounts its information gives for the topic.
 */
export function pricesOtherThan(allowed: number[]) {
  return {
    test: (text: string) => dollarAmounts(text).some((n) => !allowed.includes(n)),
    toString: () => (allowed.length ? `a price other than $${allowed.join(", $")}` : "a dollar amount"),
  };
}

/**
 * A time of day as people write it: "09:00", "9:00", "9 h", "9h30", "9 a.m.", "1:30 pm" (24-hour
 * input). Used for opening-hours cases in English and French.
 */
export function clock(hour: number, minute = 0): RegExp {
  const mm = String(minute).padStart(2, "0");
  const h12 = hour % 12 || 12;
  const half = hour < 12 ? "a" : "p";
  const twentyFour = minute ? `0?${hour}\\s?[:h.]\\s?${mm}` : `0?${hour}(\\s?[:h.]\\s?00|\\s?h\\b)`;
  const twelve = `${h12}(\\s?[:.]\\s?${mm})${minute ? "" : "?"}\\s?${half}\\.?\\s?m\\b\\.?`;
  return new RegExp(`(?<![\\d:])(${twentyFour}|${twelve})`, "i");
}
