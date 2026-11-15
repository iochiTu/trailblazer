import type { WeeklyHours } from "@traiblazer/db";

/**
 * Open appointment times: the business's opening hours, minus what its calendar says is busy, from
 * the earliest the owner accepts (notice) to the furthest ahead they allow. Times are worked out in
 * the business's time zone, so a 10:00 slot stays at 10:00 local across daylight-saving changes.
 */

export interface Interval {
  start: Date;
  end: Date;
}

/** A calendar date in the business's time zone (month 1–12). */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MINUTE = 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallClock(instant: Date, timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    seconds: Number(parts.second),
  };
}

/** The date an instant falls on in a time zone. */
export function localDate(instant: Date, timeZone: string): LocalDate {
  const { year, month, day } = wallClock(instant, timeZone);
  return { year, month, day };
}

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

const dayNumber = (date: LocalDate) => Date.UTC(date.year, date.month - 1, date.day) / 86_400_000;
const weekday = (date: LocalDate) =>
  DAY_KEYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()]!;
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-17" */
export const isoDate = (date: LocalDate) => `${date.year}-${pad(date.month)}-${pad(date.day)}`;

/**
 * The instant a wall-clock time happens on a date in a time zone, or null when that time doesn't
 * exist there (the hour skipped when clocks go forward). A time that happens twice (clocks going
 * back) is the first one.
 */
export function zonedTime(date: LocalDate, minutes: number, timeZone: string): Date | null {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  const offsetAt = (instant: number) => {
    const w = wallClock(new Date(instant), timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, 0, w.minutes, w.seconds) - Math.floor(instant / 1000) * 1000;
  };
  // Two passes settle on the offset in force at the result (it can differ from the first guess's).
  let instant = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(instant);
  if (second !== instant) instant = Math.min(instant, second);
  const check = wallClock(new Date(instant), timeZone);
  const wanted = new Date(Date.UTC(date.year, date.month - 1, date.day, 0, minutes));
  const got = new Date(Date.UTC(check.year, check.month - 1, check.day, 0, check.minutes));
  return got.getTime() === wanted.getTime() ? new Date(instant) : null;
}

/** "2026-11-17T10:00" in the business's time zone → its date and minutes after midnight; null if malformed. */
export function parseLocalTime(text: string): { date: LocalDate; minutes: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (date.month < 1 || date.month > 12 || hour > 23 || minute > 59) return null;
  // Rejects 2026-02-30 and the like.
  const check = addDays(date, 0);
  if (check.day !== date.day || check.month !== date.month) return null;
  return { date, minutes: hour * 60 + minute };
}

/** "2026-11-17T10:00": how the tools name a time to the model (business's time zone, no offset). */
export function localTimeId(instant: Date, timeZone: string): string {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(Math.floor(w.minutes / 60))}:${pad(w.minutes % 60)}`;
}

const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export interface OpenTimesInput {
  hours: WeeklyHours;
  timeZone: string;
  busy: Interval[];
  now: Date;
  durationMinutes: number;
  /** The earliest start is this long after `now`. */
  noticeMinutes: number;
  /** Last day that can be booked, counted from today (today + daysAhead). */
  daysAhead: number;
  /** First day to look at (default today); earlier days are ignored. */
  from?: LocalDate;
  /** How many days to look at from `from` (default: up to the last bookable day). */
  days?: number;
}

/** The first and last moment the days asked about cover, for asking the calendar when it is busy. */
export function searchWindow(input: Omit<OpenTimesInput, "busy" | "hours">): Interval | null {
  const days = bookableDays(input);
  if (!days.length) return null;
  const start = zonedTime(days[0]!, 0, input.timeZone) ?? zonedTime(days[0]!, 60, input.timeZone)!;
  const end =
    zonedTime(addDays(days.at(-1)!, 1), 0, input.timeZone) ??
    zonedTime(addDays(days.at(-1)!, 1), 60, input.timeZone)!;
  return { start: new Date(Math.max(start.getTime(), input.now.getTime())), end };
}

function bookableDays(input: Omit<OpenTimesInput, "busy" | "hours">): LocalDate[] {
  const today = localDate(input.now, input.timeZone);
  const last = addDays(today, input.daysAhead);
  const first = input.from && dayNumber(input.from) > dayNumber(today) ? input.from : today;
  const out: LocalDate[] = [];
  for (let date = first; dayNumber(date) <= dayNumber(last); date = addDays(date, 1)) {
    if (input.days !== undefined && out.length >= input.days) break;
    out.push(date);
  }
  return out;
}

/**
 * Every start time an appointment fits: within one opening period of its day, after the notice,
 * not overlapping anything busy. Starts are every 30 minutes from the opening time (every 15 for
 * shorter appointments), in time order.
 */
export function openTimes(input: OpenTimesInput): Date[] {
  const earliest = input.now.getTime() + input.noticeMinutes * MINUTE;
  const length = input.durationMinutes * MINUTE;
  const step = input.durationMinutes < 30 ? 15 : 30;
  const out: Date[] = [];
  for (const date of bookableDays(input)) {
    const periods = [...(input.hours[weekday(date)] ?? [])].sort(
      (a, b) => toMinutes(a.open) - toMinutes(b.open),
    );
    for (const period of periods) {
      const open = toMinutes(period.open);
      let close = toMinutes(period.close);
      // "00:00" (or anything not after the opening) closes at midnight.
      if (close <= open) close = 24 * 60;
      for (let minutes = open; minutes + input.durationMinutes <= close; minutes += step) {
        const start = zonedTime(date, minutes, input.timeZone);
        if (!start || start.getTime() < earliest) continue;
        const end = start.getTime() + length;
        if (input.busy.some((b) => start.getTime() < b.end.getTime() && end > b.start.getTime())) continue;
        out.push(start);
      }
    }
  }
  return out;
}

export type PartOfDay = "morning" | "afternoon" | "evening";

/** Before noon, noon to 5 pm, from 5 pm (local time). */
export const partOfDay = (instant: Date, timeZone: string): PartOfDay => {
  const minutes = wallClock(instant, timeZone).minutes;
  return minutes < 12 * 60 ? "morning" : minutes < 17 * 60 ? "afternoon" : "evening";
};

/**
 * A few times to offer, spread out: at most `perDay` from each day (the first, then ones spaced
 * across the day), the earliest days first, `max` in all.
 */
export function pickTimes(times: Date[], timeZone: string, options: { perDay?: number; max?: number } = {}) {
  const perDay = options.perDay ?? 3;
  const max = options.max ?? 8;
  const byDay = new Map<string, Date[]>();
  for (const time of times) {
    const key = isoDate(localDate(time, timeZone));
    byDay.set(key, [...(byDay.get(key) ?? []), time]);
  }
  const picked: Date[] = [];
  for (const day of byDay.values()) {
    const count = Math.min(perDay, day.length);
    const chosen = new Set<number>();
    for (let i = 0; i < count; i++)
      chosen.add(count === 1 ? 0 : Math.round((i * (day.length - 1)) / (count - 1)));
    for (const i of [...chosen].sort((a, b) => a - b)) {
      if (picked.length >= max) return picked;
      picked.push(day[i]!);
    }
  }
  return picked;
}
