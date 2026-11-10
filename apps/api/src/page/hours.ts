import type { WeeklyHours } from "@traiblazer/db";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Weekday (mon…sun) and minutes since midnight at `now` in the business's time zone. */
export function localClock(now: Date, timeZone: string): { day: Day; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    // An unknown zone (shouldn't happen: the admin offers the platform's list) falls back to Toronto.
    return localClock(now, "America/Toronto");
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday").slice(0, 3).toLowerCase() as Day;
  return { day: DAYS.includes(day) ? day : "mon", minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export type OpenStatus =
  | { open: true; closesAt: string | null }
  | { open: false; opensAt: { day: Day; time: string; today: boolean } | null };

/**
 * Whether the business is open at `now` by its weekly hours, with the closing time or the next
 * opening. A period that closes at or before its opening time ends after midnight (e.g. 18:00–02:00).
 * Null when no hours are given.
 */
export function openStatus(
  hours: WeeklyHours | null | undefined,
  timeZone: string,
  now: Date,
): OpenStatus | null {
  if (!hours || !DAYS.some((d) => hours[d]?.length)) return null;
  const { day, minute } = localClock(now, timeZone);
  const today = DAYS.indexOf(day);
  const slotsOf = (index: number) => hours[DAYS[(index + 7) % 7]!] ?? [];

  for (const slot of slotsOf(today)) {
    const open = minutes(slot.open);
    const close = minutes(slot.close);
    const overnight = close <= open;
    if (minute >= open && (overnight || minute < close)) return { open: true, closesAt: slot.close };
  }
  // Still in last night's overnight period.
  for (const slot of slotsOf(today - 1)) {
    const open = minutes(slot.open);
    const close = minutes(slot.close);
    if (close <= open && minute < close) return { open: true, closesAt: slot.close };
  }

  // Up to the same weekday next week (open only once a week, and that time has passed today).
  for (let offset = 0; offset <= 7; offset++) {
    const slots = [...slotsOf(today + offset)].sort((a, b) => minutes(a.open) - minutes(b.open));
    const next = slots.find((slot) => offset > 0 || minutes(slot.open) > minute);
    if (next) {
      return {
        open: false,
        opensAt: { day: DAYS[(today + offset) % 7]!, time: next.open, today: offset === 0 },
      };
    }
  }
  return { open: false, opensAt: null };
}
