import { getTemplate } from "@traiblazer/industry-packs";
import { describe, expect, it } from "vitest";
import { MarkerFilter } from "./markers.js";
import { buildSystemBlocks, parseSearchQueries } from "./prompt.js";
import { checkServiceArea } from "./tools/service-area.js";
import { higherUrgency, keywordTriage, parseTriage } from "./triage.js";

const trades = getTemplate("trades", "plumbing").triage;
const auto = getTemplate("auto-repair", "tires").triage;
const cafe = getTemplate("cafe-bakery", null).triage;

describe("keyword triage", () => {
  it("finds a danger to life for any business, in English and French", () => {
    expect(keywordTriage("I smell gas in the basement", trades)).toBe("danger");
    expect(keywordTriage("Our CO alarm is beeping!!", cafe)).toBe("danger");
    expect(keywordTriage("Il y a une odeur de gaz dans la cuisine", trades)).toBe("danger");
    expect(keywordTriage("De la FUMÉE sort de la prise", trades)).toBe("danger");
  });

  it("finds the industry's urgent problems", () => {
    expect(keywordTriage("A pipe burst — no wait, it's a burst pipe under the sink", trades)).toBe("urgent");
    expect(keywordTriage("We have no heat and it's -20", trades)).toBe("urgent");
    expect(keywordTriage("Ma fournaise ne fonctionne plus, pas de chauffage", trades)).toBe("urgent");
    expect(keywordTriage("My car won't start in the parking lot", auto)).toBe("urgent");
    expect(keywordTriage("J'ai besoin d'une remorqueuse", auto)).toBe("urgent");
  });

  it("matches whole words only and leaves routine questions alone", () => {
    expect(keywordTriage("Do you install gas fireplaces?", trades)).toBeNull();
    expect(keywordTriage("Can you replace my spark plugs?", auto)).toBeNull();
    expect(keywordTriage("How much is drain cleaning?", trades)).toBeNull();
    // Urgent words belong to their industry: a café's visitor with no heat isn't a job for it.
    expect(keywordTriage("no heat in here", cafe)).toBeNull();
    expect(keywordTriage("", trades)).toBeNull();
  });

  it("keeps the more serious reading", () => {
    expect(higherUrgency("urgent", "danger")).toBe("danger");
    expect(higherUrgency("danger", "urgent")).toBe("danger");
    expect(higherUrgency(null, "urgent")).toBe("urgent");
    expect(higherUrgency(null, null)).toBeNull();
  });
});

describe("the auxiliary model's triage", () => {
  it("reads the TYPE line and treats anything else as routine", () => {
    expect(parseTriage("EN: gas smell\nFR: odeur de gaz\nTYPE: danger")).toEqual({
      urgency: "danger",
      advice: false,
    });
    expect(parseTriage("EN: x\nFR: y\ntype: Urgent.")).toEqual({ urgency: "urgent", advice: false });
    expect(parseTriage("EN: x\nFR: y\nTYPE: advice")).toEqual({ urgency: null, advice: true });
    expect(parseTriage("EN: x\nFR: y")).toEqual({ urgency: null, advice: false });
    expect(parseTriage("TYPE: maybe dangerous")).toEqual({ urgency: null, advice: false });
  });

  it("doesn't turn the TYPE line into a search query", () => {
    expect(parseSearchQueries("EN: burst pipe\nFR: tuyau éclaté\nTYPE: urgent", "help")).toEqual([
      "help",
      "burst pipe",
      "tuyau éclaté",
    ]);
  });

  it("tells the answering model how the message was sorted", () => {
    const bot = {
      id: "b",
      name: "Smith",
      pack: "trades",
      variant: null,
      languages: ["en"],
      defaultLanguage: "en",
      settings: {},
      persona: null,
    } as never;
    const dynamic = (triage?: { urgency: "urgent" | "danger" | null; advice: boolean }) =>
      buildSystemBlocks({ bot, profile: null, passages: [], triage, now: new Date() })[2]!.text;
    expect(dynamic({ urgency: "danger", advice: false })).toContain(
      "<triage>\nThe visitor's latest message describes a possible danger to life.",
    );
    expect(dynamic({ urgency: "urgent", advice: false })).toContain("[[action:call]]");
    expect(dynamic({ urgency: null, advice: true })).toContain("can't give that here");
    expect(dynamic({ urgency: null, advice: false })).not.toContain("<triage>");
    expect(dynamic()).not.toContain("<triage>");
  });
});

describe("service-area check", () => {
  const area = { towns: ["Guelph", "Fergus", "Elora", "St. Jacobs"], postalPrefixes: ["N1H", "N1E", "n0b"] };

  it("matches postal codes by their beginning", () => {
    expect(checkServiceArea("12 Main St, N1H 4E6", area)).toEqual({ result: "in", matched: "N1H" });
    expect(checkServiceArea("n0b2j0", area)).toEqual({ result: "in", matched: "N0B" });
    expect(checkServiceArea("N2L 3G1", area)).toEqual({ result: "not_listed" });
  });

  it("matches listed towns in the visitor's words, without case or accents", () => {
    expect(checkServiceArea("I'm in fergus, ON", area)).toEqual({ result: "in", matched: "Fergus" });
    expect(checkServiceArea("st jacobs", area)).toEqual({ result: "in", matched: "St. Jacobs" });
    expect(checkServiceArea("Kitchener", area)).toEqual({ result: "not_listed" });
    // A town that only contains a listed name is a different place.
    expect(checkServiceArea("Guelph-Eramosa", { towns: ["Elora"], postalPrefixes: [] })).toEqual({
      result: "not_listed",
    });
  });

  it("asks again when it can't tell", () => {
    expect(checkServiceArea("Kitchener", { towns: [], postalPrefixes: ["N1H"] })).toEqual({
      result: "unclear",
    });
    expect(checkServiceArea("12", area)).toEqual({ result: "unclear" });
  });
});

describe("button markers", () => {
  it("takes call and book markers out of the text, even split across chunks", () => {
    const filter = new MarkerFilter();
    const a = filter.push("Please call us now.\n[[act");
    const b = filter.push("ion:call]]\nOr book: [[action:book]]");
    expect(a.text + b.text + filter.flush()).toBe("Please call us now.\nOr book: ");
    expect([...a.actions, ...b.actions]).toEqual(["call", "book"]);
  });
});
