import { describe, expect, it } from "vitest";
import { localTimeId, openTimes, parseLocalTime, pickTimes, searchWindow, zonedTime } from "./slots.js";

const TZ = "America/Toronto";
const weekdays = { open: "09:00", close: "17:00" };
const hours = { mon: [weekdays], tue: [weekdays], wed: [weekdays], thu: [weekdays], fri: [weekdays] };
const ids = (times: Date[]) => times.map((t) => localTimeId(t, TZ));

describe("time zones", () => {
  it("turns local times into instants, across daylight-saving changes", () => {
    expect(zonedTime({ year: 2026, month: 11, day: 17 }, 600, TZ)?.toISOString()).toBe(
      "2026-11-17T15:00:00.000Z",
    );
    expect(zonedTime({ year: 2026, month: 7, day: 17 }, 600, TZ)?.toISOString()).toBe(
      "2026-07-17T14:00:00.000Z",
    );
    // 2:30 doesn't exist on 8 March 2026 (clocks go 2:00 → 3:00); 1:30 happens twice on 1 November.
    expect(zonedTime({ year: 2026, month: 3, day: 8 }, 150, TZ)).toBeNull();
    expect(zonedTime({ year: 2026, month: 11, day: 1 }, 90, TZ)?.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(zonedTime({ year: 2026, month: 11, day: 17 }, 600, "America/Halifax")?.toISOString()).toBe(
      "2026-11-17T14:00:00.000Z",
    );
  });

  it("reads the times the tools hand out, and nothing else", () => {
    expect(parseLocalTime("2026-11-17T10:30")).toEqual({
      date: { year: 2026, month: 11, day: 17 },
      minutes: 630,
    });
    expect(parseLocalTime("2026-02-30T10:00")).toBeNull();
    expect(parseLocalTime("2026-11-17T24:00")).toBeNull();
    expect(parseLocalTime("tomorrow at 10")).toBeNull();
    expect(localTimeId(new Date("2026-11-17T15:00:00Z"), TZ)).toBe("2026-11-17T10:00");
  });
});

describe("open times", () => {
  // Monday 16 November 2026, 08:00 in Toronto.
  const now = new Date("2026-11-16T13:00:00Z");
  const base = { hours, timeZone: TZ, busy: [], now, durationMinutes: 60, noticeMinutes: 0, daysAhead: 14 };

  it("fits appointments inside opening hours, every 30 minutes", () => {
    const today = openTimes({ ...base, days: 1 });
    expect(ids(today)[0]).toBe("2026-11-16T09:00");
    expect(ids(today).at(-1)).toBe("2026-11-16T16:00");
    expect(today).toHaveLength(15);
  });

  it("leaves out busy times, the notice period, closed days and days too far ahead", () => {
    const busy = [{ start: new Date("2026-11-17T15:00:00Z"), end: new Date("2026-11-17T16:30:00Z") }];
    const tuesday = ids(openTimes({ ...base, busy, from: { year: 2026, month: 11, day: 17 }, days: 1 }));
    // Busy 10:00–11:30: 9:00 still fits (ends 10:00); 9:30 to 11:00 don't.
    expect(tuesday).toContain("2026-11-17T09:00");
    expect(tuesday).not.toContain("2026-11-17T09:30");
    expect(tuesday).not.toContain("2026-11-17T11:00");
    expect(tuesday).toContain("2026-11-17T11:30");

    // 24 hours' notice from Monday 08:00: nothing before Tuesday 08:00.
    expect(ids(openTimes({ ...base, noticeMinutes: 24 * 60 }))[0]).toBe("2026-11-17T09:00");

    const all = ids(openTimes({ ...base, daysAhead: 6 }));
    expect(all.some((t) => t.startsWith("2026-11-21") || t.startsWith("2026-11-22"))).toBe(false);
    expect(all.at(-1)!.startsWith("2026-11-20")).toBe(true);
    expect(openTimes({ ...base, from: { year: 2026, month: 12, day: 30 } })).toEqual([]);
  });

  it("handles split days, midnight closing and empty hours", () => {
    const split = {
      sat: [
        { open: "13:00", close: "15:00" },
        { open: "08:00", close: "10:00" },
      ],
    };
    const saturday = ids(
      openTimes({ ...base, hours: split, from: { year: 2026, month: 11, day: 21 }, days: 1 }),
    );
    expect(saturday).toEqual([
      "2026-11-21T08:00",
      "2026-11-21T08:30",
      "2026-11-21T09:00",
      "2026-11-21T13:00",
      "2026-11-21T13:30",
      "2026-11-21T14:00",
    ]);
    const late = { mon: [{ open: "22:00", close: "00:00" }] };
    expect(ids(openTimes({ ...base, hours: late, days: 1 }))).toEqual([
      "2026-11-16T22:00",
      "2026-11-16T22:30",
      "2026-11-16T23:00",
    ]);
    expect(openTimes({ ...base, hours: {} })).toEqual([]);
  });

  it("asks the calendar about the right window and spreads the times it offers", () => {
    const window = searchWindow({ ...base, from: { year: 2026, month: 11, day: 17 }, days: 2 })!;
    expect(window.start.toISOString()).toBe("2026-11-17T05:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-19T05:00:00.000Z");
    expect(searchWindow({ ...base, days: 1 })!.start).toEqual(now);

    const picked = ids(pickTimes(openTimes({ ...base, days: 4 }), TZ, { perDay: 3, max: 8 }));
    expect(picked).toEqual([
      "2026-11-16T09:00",
      "2026-11-16T12:30",
      "2026-11-16T16:00",
      "2026-11-17T09:00",
      "2026-11-17T12:30",
      "2026-11-17T16:00",
      "2026-11-18T09:00",
      "2026-11-18T12:30",
    ]);
  });
});
