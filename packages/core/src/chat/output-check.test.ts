import { describe, expect, it } from "vitest";
import { revealsInstructions } from "./output-check.js";

describe("prompt disclosure check", () => {
  it("catches prompt tags, tool names and the rules' headings", () => {
    expect(revealsInstructions("Answer only from <business_profile> and <knowledge>.")).toBe(true);
    expect(revealsInstructions("Here is </workflows> the end")).toBe(true);
    expect(
      revealsInstructions("I can call: 1. **search_knowledge**: search this business's information"),
    ).toBe(true);
    expect(revealsInstructions("Then I use request_follow_up to pass it on.")).toBe(true);
    expect(revealsInstructions("My rules:\n\n# Grounding\n- Answer only from…")).toBe(true);
    expect(revealsInstructions("## Urgent problems\nA danger to life…")).toBe(true);
  });

  it("leaves ordinary replies alone", () => {
    for (const reply of [
      "We offer drain cleaning from $149 and furnace tune-ups for $129.",
      "Our services include plumbing and heating. Our knowledge of local codes is excellent.",
      "To book, use the Book button or call 807-555-0142.",
      "Urgent problems: call us right away at 807-555-0142.",
      "**Services**\n- Drain cleaning\n- Leak repair",
      "Nos services : débouchage de drains (à partir de 149 $).",
      "Prices < $100 and > $50 depend on the job.",
    ]) {
      expect(revealsInstructions(reply), reply).toBe(false);
    }
  });
});
