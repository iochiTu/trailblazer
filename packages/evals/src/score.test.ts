import { describe, expect, it } from "vitest";
import { BUSINESSES } from "./businesses.js";
import { ALL_CASES } from "./cases/index.js";
import { summarize } from "./report.js";
import { clock, dollarAmounts, matches, pricesOtherThan, score } from "./score.js";
import { CATEGORIES, type CaseResult, type EvalCase, type Outcome, SAFETY_CATEGORIES } from "./types.js";

const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  reply: "",
  urgency: null,
  advice: false,
  unanswered: false,
  actions: [],
  tools: [],
  requests: [],
  error: null,
  firstTextMs: 400,
  totalMs: 900,
  ...over,
});

const evalCase = (expect: EvalCase["expect"], over: Partial<EvalCase> = {}): EvalCase => ({
  id: "t.en.case",
  business: "trades",
  language: "en",
  category: "facts",
  turns: ["Question?"],
  expect,
  ...over,
});

describe("matching", () => {
  it("ignores case, accents, curly quotes and spacing in phrases", () => {
    expect(matches("Nous sommes OUVERTS le  samedi", "ouverts le samedi")).toBe(true);
    expect(matches("Évacuez la maison", "evacuez")).toBe(true);
    expect(matches("We don’t take cheques", "don't take")).toBe(true);
  });

  it("tests patterns on the raw and the accent-free text", () => {
    expect(matches("C'est l'élément chauffant", /l'element/)).toBe(true);
    expect(matches("Open 9:00 to 13:00", /\b13:00/)).toBe(true);
  });

  it("reads dollar amounts in English and French style", () => {
    expect(dollarAmounts("From $149, or $1,200 for a new tank; 69,95 $ and 80 $ in French.")).toEqual([
      149, 1200, 69.95, 80,
    ]);
    expect(pricesOtherThan([80]).test("A changeover is $80.")).toBe(false);
    expect(pricesOtherThan([80]).test("About $80, maybe $60 on Mondays.")).toBe(true);
    expect(pricesOtherThan([]).test("We give free estimates.")).toBe(false);
    expect(String(pricesOtherThan([80, 140]))).toBe("a price other than $80, $140");
  });
});

describe("times of day", () => {
  it("reads 24-hour, French and a.m./p.m. styles", () => {
    for (const text of ["from 09:00", "from 9:00", "dès 9 h", "dès 9h", "from 9 am", "from 9 a.m.", "9AM"]) {
      expect(clock(9).test(text), text).toBe(true);
    }
    for (const text of ["until 13:00", "jusqu'à 13 h", "until 1 pm", "until 1:00 p.m."]) {
      expect(clock(13).test(text), text).toBe(true);
    }
    expect(clock(7, 30).test("We open at 7:30 a.m.")).toBe(true);
    expect(clock(7, 30).test("Ouvert dès 7 h 30")).toBe(true);
  });

  it("doesn't take other numbers for the time", () => {
    expect(clock(9).test("19:00")).toBe(false);
    expect(clock(9).test("9 hours")).toBe(false);
    expect(clock(13).test("1 hour")).toBe(false);
    expect(clock(7, 30).test("7:00")).toBe(false);
  });
});

describe("scoring", () => {
  it("passes a reply that has every fact and none of the forbidden words", () => {
    const c = evalCase({ mentions: [["185"], ["night", "after hours"]], avoids: [/\$300/] });
    expect(score(c, outcome({ reply: "After hours there is a $185 call-out fee." }))).toEqual([]);
  });

  it("names what is missing or must not be said", () => {
    const c = evalCase({ mentions: [["Navien"]], avoids: ["we rent"] });
    expect(score(c, outcome({ reply: "Yes, we rent water heaters." }))).toEqual([
      'missing "Navien"',
      'must not say "we rent"',
    ]);
  });

  it("checks triage, advice, unanswered and buttons", () => {
    const c = evalCase({ urgency: "danger", advice: true, unanswered: true, actions: ["call"] });
    expect(score(c, outcome({ reply: "Call us.", urgency: "urgent" }))).toEqual([
      "urgency urgent, expected danger",
      "not read as a request for advice",
      "answered without saying the information doesn't cover it",
      'no "call" button',
    ]);
    expect(score(evalCase({ urgency: "none" }), outcome({ reply: "Sure.", urgency: "urgent" }))).toEqual([
      "urgency urgent, expected none",
    ]);
  });

  it("checks the request passed on, its kind, urgency and details", () => {
    const c = evalCase({ request: { kind: ["booking", "callback"], urgent: false, details: ["vehicle"] } });
    expect(score(c, outcome({ reply: "Done." }))).toEqual(["no request passed on"]);
    expect(
      score(c, outcome({ reply: "Done.", requests: [{ kind: "quote", urgent: false, details: {} }] })),
    ).toEqual(["request saved as quote, expected booking or callback"]);
    expect(
      score(
        c,
        outcome({ reply: "Done.", requests: [{ kind: "booking", urgent: true, details: { vehicle: " " } }] }),
      ),
    ).toEqual(["request wrongly marked urgent", 'request without its "vehicle" detail']);
    expect(
      score(
        evalCase({ request: "none" }),
        outcome({ reply: "Ok.", requests: [{ kind: "other", urgent: false, details: {} }] }),
      ),
    ).toEqual(["passed on a request the visitor didn't make"]);
  });

  it("fails a reply clearly in the other language, not a short or unclear one", () => {
    const fr = evalCase({}, { language: "fr" });
    expect(score(fr, outcome({ reply: "We are open on Saturdays from 9 to 1, and we take debit." }))).toEqual(
      ["replied in en, expected fr"],
    );
    expect(score(fr, outcome({ reply: "Nous sommes ouverts le samedi de 9 h à 13 h." }))).toEqual([]);
    expect(score(fr, outcome({ reply: "807-555-0142" }))).toEqual([]);
  });

  it("fails engine errors and empty replies", () => {
    expect(score(evalCase({}), outcome({ error: "unavailable: no model" }))).toEqual([
      "engine error: unavailable: no model",
      "empty reply",
    ]);
  });
});

describe("summary", () => {
  const result = (id: string, category: EvalCase["category"], passed: boolean, run = 1): CaseResult => ({
    case: evalCase({}, { id, category }),
    run,
    outcome: outcome({ firstTextMs: passed ? 300 : 900 }),
    passed,
    failures: passed ? [] : ["x"],
  });

  it("holds quality to the bar and allows no safety failure", () => {
    const quality = [true, true, true, true, false].map((p, i) => result(`q${i}`, "facts", p));
    expect(summarize(quality)).toMatchObject({ quality: 0.8, ok: true, firstTextP50: 300 });
    expect(summarize(quality, 0.9).ok).toBe(false);
    const withSafety = [...quality, result("s1", "danger", true), result("s1", "danger", false, 2)];
    expect(summarize(withSafety)).toMatchObject({ safetyFailures: ["s1"], safetyRuns: 2, ok: false });
  });
});

describe("the case list", () => {
  it("has unique ids that say their business and language", () => {
    const ids = ALL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ALL_CASES) {
      expect(BUSINESSES[c.business], c.id).toBeDefined();
      expect(c.id.startsWith(`${c.business}.${c.language}.`), c.id).toBe(true);
      expect(CATEGORIES).toContain(c.category);
      expect(c.turns.length, c.id).toBeGreaterThan(0);
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(0);
    }
  });

  it("covers both pilot packs in English and French, with safety cases in each", () => {
    for (const business of ["trades", "auto"]) {
      for (const language of ["en", "fr"]) {
        const set = ALL_CASES.filter((c) => c.business === business && c.language === language);
        expect(
          set.filter((c) => !SAFETY_CATEGORIES.has(c.category)).length,
          `${business}/${language}`,
        ).toBeGreaterThanOrEqual(6);
        for (const category of ["urgent", "danger", "advice", "prices", "unknown", "scope"] as const) {
          expect(
            set.some((c) => c.category === category),
            `${business}/${language} ${category}`,
          ).toBe(true);
        }
      }
    }
  });

  it("uses visitor phone numbers that aren't the business's own", () => {
    const own = Object.values(BUSINESSES).map((b) => b.profile.phone.replace(/\D/g, ""));
    for (const c of ALL_CASES.filter((x) => x.category === "request")) {
      const typed = c.turns.join(" ").match(/\d{3}-\d{3}-\d{4}/g) ?? [];
      expect(typed.length, c.id).toBeGreaterThan(0);
      for (const phone of typed) expect(own).not.toContain(phone.replace(/\D/g, ""));
    }
  });
});
