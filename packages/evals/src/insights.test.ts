import { INSIGHT_DIMENSIONS } from "@traiblazer/db";
import { describe, expect, it } from "vitest";
import { INSIGHT_CASES, scoreInsight } from "./insights.js";

describe("insights eval cases", () => {
  it("are labelled with values from the fixed lists, in both languages", () => {
    const ids = new Set<string>();
    for (const c of INSIGHT_CASES) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(INSIGHT_DIMENSIONS.intent, c.id).toContain(c.expected.intent);
      expect(INSIGHT_DIMENSIONS.sentiment, c.id).toContain(c.expected.sentiment);
      // A conversation that ended in a request has no blocker; one that didn't always has one.
      if (c.requested) expect(c.expected.blocker, c.id).toBeNull();
      else expect(INSIGHT_DIMENSIONS.blocker, c.id).toContain(c.expected.blocker);
    }
    expect(INSIGHT_CASES.filter((c) => c.language === "fr").length).toBeGreaterThanOrEqual(8);
    expect(INSIGHT_CASES.filter((c) => c.language === "en").length).toBeGreaterThanOrEqual(8);
  });

  it("accepts the other right answers and nothing else", () => {
    const c = INSIGHT_CASES.find((x) => x.id === "booked-out")!;
    expect(scoreInsight(c, { intent: "emergency", sentiment: "negative", blocker: "availability" })).toEqual({
      intent: true,
      sentiment: true,
      blocker: true,
    });
    expect(scoreInsight(c, { intent: "price", sentiment: "positive", blocker: "price" })).toEqual({
      intent: false,
      sentiment: false,
      blocker: false,
    });
    expect(scoreInsight(c, null).intent).toBe(false);
  });
});
