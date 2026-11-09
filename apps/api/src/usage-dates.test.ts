import { describe, expect, it } from "vitest";
import { lastDates } from "./routes/usage.js";

const consecutive = (dates: string[]) =>
  dates.every((d, i) => i === 0 || Date.parse(d) - Date.parse(dates[i - 1]!) === 86_400_000);

describe("usage report dates", () => {
  it.each([
    // Late evening in Toronto a week after clocks fell back (the CI run that returned 29 days).
    "2026-11-09T04:39:57Z",
    // Just after midnight right after clocks sprang forward, and on ordinary days.
    "2026-03-09T04:30:00Z",
    "2026-11-01T05:30:00Z",
    "2026-07-15T12:00:00Z",
    "2026-01-01T04:59:59Z",
  ])("returns exactly N consecutive dates ending today (%s)", (iso) => {
    const now = new Date(iso);
    for (const days of [7, 30, 90]) {
      const dates = lastDates(days, now);
      expect(dates).toHaveLength(days);
      expect(new Set(dates).size).toBe(days);
      expect(consecutive(dates)).toBe(true);
    }
  });

  it("ends on today's date in the reporting time zone", () => {
    // 04:39 UTC on Nov 9 is still the evening of Nov 8 in Toronto.
    const dates = lastDates(30, new Date("2026-11-09T04:39:57Z"));
    expect(dates.at(-1)).toBe("2026-11-08");
    expect(dates[0]).toBe("2026-10-10");
  });
});
