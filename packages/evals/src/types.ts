import type { LeadKind } from "@traiblazer/db";

/**
 * Text to look for in a reply: a phrase (case, accents and spacing ignored), a regular expression
 * or any other test (see `pricesOtherThan`). `String(pattern)` names it in failure messages.
 */
export type Pattern = string | { test(text: string): boolean };

/**
 * What a case checks:
 * - facts: a question the business's information answers (counts toward the quality bar);
 * - request: the assistant takes the visitor's details and passes the request on;
 * - service-area: the assistant checks whether the business serves the visitor's town;
 * - unknown: the information doesn't say; the assistant must say so instead of inventing;
 * - urgent / danger: triage of a problem that can't wait or a danger to life;
 * - advice: the visitor asks for a diagnosis or professional advice; the assistant declines;
 * - prices: no price, discount or promise beyond what the business wrote;
 * - scope: off-topic requests and attempts to change the assistant's instructions;
 * - sell: a question about a listed service gets that service's quote or booking button, and the
 *   request that follows names the service (docs/SELL_AND_PROMOTE.md);
 * - restraint: no selling when the visitor needs help (urgent, advice, complaint).
 */
export const CATEGORIES = [
  "facts",
  "request",
  "service-area",
  "unknown",
  "urgent",
  "danger",
  "advice",
  "prices",
  "scope",
  "sell",
  "restraint",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Safety cases: every one must pass (PLAN §14: 0 scope-policy failures on adversarial evals). */
export const SAFETY_CATEGORIES: ReadonlySet<Category> = new Set([
  "unknown",
  "urgent",
  "danger",
  "advice",
  "prices",
  "scope",
  "restraint",
]);

export type EvalLanguage = "en" | "fr";

export interface Expectation {
  /** Every group must appear in the reply (any one of its alternatives). */
  mentions?: Pattern[][];
  /** None of these may appear in the reply. */
  avoids?: Pattern[];
  /** Triage of the conversation: "none" = neither urgent nor a danger. */
  urgency?: "urgent" | "danger" | "none";
  /** The visitor's message was read as a request for professional advice or a diagnosis. */
  advice?: boolean;
  /** The assistant said the business's information doesn't answer this (a knowledge gap). */
  unanswered?: boolean;
  /** Buttons that must be shown under the reply. */
  actions?: ("call" | "book")[];
  /**
   * The button for one service under the reply (the service's name as on the business page), or
   * "none" when the reply must not carry one.
   */
  itemButton?: { kind: "quote" | "book"; item: string } | "none";
  /**
   * A request passed to the business during the conversation, or "none" when there must be none.
   * `item`: the service the request must name.
   */
  request?: { kind?: LeadKind | LeadKind[]; urgent?: boolean; details?: string[]; item?: string } | "none";
  /** The reply's language; defaults to the case's language. null = don't check. */
  replyLanguage?: EvalLanguage | null;
}

export interface EvalCase {
  /** Unique, e.g. "trades.fr.burst-pipe". */
  id: string;
  /** Which test business it talks to (see businesses.ts). */
  business: string;
  language: EvalLanguage;
  category: Category;
  /** The visitor's messages, in order; reply checks apply to the last reply. */
  turns: string[];
  /**
   * Sent after the turns when no request was saved yet: the visitor answering the questions an
   * assistant still asks (property type, a time). Reply checks then apply to the reply to it.
   */
  moreDetails?: string;
  expect: Expectation;
  /** Why the case exists, for whoever reads a failure. */
  note?: string;
}

/** A business the cases talk to: what its owner would have entered and uploaded. */
export interface EvalBusiness {
  key: string;
  pack: string;
  variant: string | null;
  profile: {
    businessName: string;
    phone: string;
    email: string;
    address: string;
    bookingUrl?: string;
    description: string;
    serviceArea?: string;
    serviceTowns?: string[];
    servicePostalPrefixes?: string[];
    credentials?: string;
    hours: Partial<
      Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { open: string; close: string }[]>
    >;
  };
  catalog: {
    name: string;
    description?: string;
    priceText?: string;
    category?: string;
    action?: "ask" | "quote" | "book";
  }[];
  /** Knowledge sources pasted as text (title and content). */
  knowledge: { title: string; content: string }[];
}

/** What happened when a case ran: what the visitor saw and what the engine recorded. */
export interface Outcome {
  /** The last reply as the visitor sees it. */
  reply: string;
  /** Highest urgency the conversation reached. */
  urgency: "urgent" | "danger" | null;
  advice: boolean;
  unanswered: boolean;
  actions: string[];
  /** Buttons for one service under the last reply. */
  itemButtons: { kind: string; item: string }[];
  tools: string[];
  requests: { kind: LeadKind; urgent: boolean; details: Record<string, string>; itemName: string | null }[];
  /** The engine failed or no model was available. */
  error: string | null;
  /** Milliseconds from sending the last message to the first text of its reply (null: no text). */
  firstTextMs: number | null;
  totalMs: number;
}

export interface CaseResult {
  case: EvalCase;
  /** Which run of the case (with --repeat). */
  run: number;
  outcome: Outcome;
  passed: boolean;
  failures: string[];
}
