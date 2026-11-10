/** The business details form: what the owner types, and how it maps to the saved profile. */
import type { BusinessProfile, DayKey, WeeklyHours } from "./api";

export const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** The business details as text fields. Hours are one line per day, e.g. "11:00-14:00, 17:00-21:00". */
export interface ProfileDraft {
  businessName: string;
  phone: string;
  email: string;
  websiteUrl: string;
  address: string;
  bookingUrl: string;
  orderingUrl: string;
  timezone: string;
  hours: Record<DayKey, string>;
}
export type ProfileField = Exclude<keyof ProfileDraft, "hours" | "timezone">;

export const hoursToText = (slots: { open: string; close: string }[] | undefined) =>
  (slots ?? []).map((slot) => `${slot.open}-${slot.close}`).join(", ");

const pad = (hour: string, minute = "00") => `${hour.padStart(2, "0")}:${minute}`;

/** One day's line as opening periods; null when it can't be read. An empty line is a closed day. */
export function textToSlots(text: string): { open: string; close: string }[] | null {
  const slots: { open: string; close: string }[] = [];
  for (const part of text.split(",")) {
    if (!part.trim()) continue;
    const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(part);
    if (!match) return null;
    const [, openHour, openMinute, closeHour, closeMinute] = match;
    if (Number(openHour) > 23 || Number(closeHour) > 23) return null;
    if (Number(openMinute ?? 0) > 59 || Number(closeMinute ?? 0) > 59) return null;
    slots.push({ open: pad(openHour!, openMinute), close: pad(closeHour!, closeMinute) });
  }
  return slots.length <= 4 ? slots : null;
}

export function hoursToDraft(hours: WeeklyHours | null | undefined): Record<DayKey, string> {
  return Object.fromEntries(DAYS.map((day) => [day, hoursToText(hours?.[day])])) as Record<DayKey, string>;
}

export function draftFromProfile(profile: BusinessProfile | null): ProfileDraft {
  return {
    businessName: profile?.businessName ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    websiteUrl: profile?.websiteUrl ?? "",
    address: Object.values(profile?.address ?? {})
      .filter(Boolean)
      .join(", "),
    bookingUrl: profile?.bookingUrl ?? "",
    orderingUrl: profile?.orderingUrl ?? "",
    timezone: profile?.timezone ?? "America/Toronto",
    hours: hoursToDraft(profile?.hours),
  };
}

/**
 * The profile to save from the form. Empty fields are saved as "not given"; with every day empty the
 * hours are not given either. Returns the day whose hours can't be read instead, if there is one.
 */
export function draftToProfile(
  draft: ProfileDraft,
): { profile: Partial<BusinessProfile>; invalidDay?: undefined } | { invalidDay: DayKey } {
  const hours: WeeklyHours = {};
  for (const day of DAYS) {
    const slots = textToSlots(draft.hours[day]);
    if (!slots) return { invalidDay: day };
    hours[day] = slots;
  }
  const given = (value: string) => value.trim() || null;
  const address = given(draft.address);
  return {
    profile: {
      businessName: given(draft.businessName),
      phone: given(draft.phone),
      email: given(draft.email),
      websiteUrl: given(draft.websiteUrl),
      address: address ? { full: address } : null,
      bookingUrl: given(draft.bookingUrl),
      orderingUrl: given(draft.orderingUrl),
      timezone: draft.timezone,
      hours: DAYS.some((day) => hours[day]!.length) ? hours : null,
    },
  };
}
