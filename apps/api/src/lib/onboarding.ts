import {
  bots,
  businessProfiles,
  catalogItems,
  knowledgeImages,
  knowledgeSources,
  type OnboardingMark,
  type Tx,
} from "@traiblazer/db";
import {
  MANUAL_ONBOARDING_STEPS,
  ONBOARDING_STEPS,
  type OnboardingStep,
  REPORTING_TIME_ZONE,
} from "@traiblazer/shared";
import { and, eq, isNotNull } from "drizzle-orm";

// ---- Due time ---------------------------------------------------------------------------------

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock date and time of an instant in a time zone. */
function wallClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday!]!,
  };
}

/** The instant a wall-clock time in a time zone stands for (daylight saving time included). */
function fromWallClock(
  wall: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offsetAt = (instant: number) => {
    const w = wallClock(new Date(instant), timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - instant;
  };
  // Twice: the offset at the first guess can differ from the offset at the answer around a change.
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant);
}

/**
 * When a page is due: the same time on the next working day (Monday to Friday) in the reporting
 * time zone. Materials received on a Saturday or Sunday start the clock on Monday at 9:00, so they
 * are due Tuesday at 9:00. Statutory holidays aren't counted.
 */
export function dueAfterOneWorkingDay(received: Date, timeZone = REPORTING_TIME_ZONE): Date {
  let wall = wallClock(received, timeZone);
  const shiftDays = (days: number) => {
    const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
    wall = {
      ...wall,
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      weekday: next.getUTCDay(),
    };
  };
  if (wall.weekday === 6 || wall.weekday === 0) {
    shiftDays(wall.weekday === 6 ? 2 : 1);
    wall = { ...wall, hour: 9, minute: 0, second: 0 };
  }
  shiftDays(1);
  while (wall.weekday === 6 || wall.weekday === 0) shiftDays(1);
  return fromWallClock(wall, timeZone);
}

// ---- Steps ------------------------------------------------------------------------------------

/** What the business's own data says about the steps that are checked automatically. */
export interface OnboardingFacts {
  sources: { ready: number; failed: number; pending: number };
  /** Parts of the page content still missing. */
  missing: ("description" | "contact" | "hours")[];
  services: number;
  photos: number;
  live: boolean;
}

/** Reads the facts for one assistant (inside the business's tenant context: RLS applies). */
export async function onboardingFacts(tx: Tx, botId: string): Promise<OnboardingFacts | null> {
  const [bot] = await tx
    .select({ status: bots.status, hostedPageEnabled: bots.hostedPageEnabled })
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  if (!bot) return null;
  const sources = await tx
    .select({ status: knowledgeSources.status })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.botId, botId));
  const [profile] = await tx
    .select({
      description: businessProfiles.description,
      phone: businessProfiles.phone,
      email: businessProfiles.email,
      hours: businessProfiles.hours,
    })
    .from(businessProfiles)
    .where(eq(businessProfiles.botId, botId))
    .limit(1);
  const items = await tx
    .select({ assetId: catalogItems.assetId })
    .from(catalogItems)
    .where(and(eq(catalogItems.botId, botId), eq(catalogItems.enabled, true)));
  const images = await tx
    .select({ id: knowledgeImages.id })
    .from(knowledgeImages)
    .where(
      and(
        eq(knowledgeImages.botId, botId),
        eq(knowledgeImages.enabled, true),
        isNotNull(knowledgeImages.assetId),
      ),
    );

  const missing: OnboardingFacts["missing"] = [];
  if (!profile?.description?.trim()) missing.push("description");
  if (!profile?.phone?.trim() && !profile?.email?.trim()) missing.push("contact");
  if (!Object.values(profile?.hours ?? {}).some((day) => day?.length)) missing.push("hours");

  return {
    sources: {
      ready: sources.filter((s) => s.status === "ready").length,
      failed: sources.filter((s) => s.status === "failed").length,
      pending: sources.filter((s) => s.status === "pending" || s.status === "processing").length,
    },
    missing,
    services: items.length,
    photos: images.length + items.filter((i) => i.assetId).length,
    live: bot.status === "active" && bot.hostedPageEnabled,
  };
}

/** True when the business's data already shows the step done (staff steps never are). */
function detected(step: OnboardingStep, facts: OnboardingFacts): boolean {
  switch (step) {
    case "sources":
      return facts.sources.ready > 0;
    case "page":
      return facts.missing.length === 0;
    case "services":
      return facts.services > 0;
    case "photos":
      return facts.photos > 0;
    case "live":
      return facts.live;
    default:
      return false;
  }
}

export interface OnboardingStepState {
  id: OnboardingStep;
  /** Ticked by staff (true) or checked from the business's data (false). */
  manual: boolean;
  state: "done" | "skipped" | "open";
  /** Who marked it and when, when staff did. */
  mark: OnboardingMark | null;
}

/** Each step's state: seen in the business's data, or marked by staff. */
export function onboardingSteps(
  facts: OnboardingFacts,
  marks: Record<string, OnboardingMark>,
): OnboardingStepState[] {
  return ONBOARDING_STEPS.map((id) => {
    const manual = MANUAL_ONBOARDING_STEPS.includes(id);
    const mark = marks[id] ?? null;
    const state = detected(id, facts) ? "done" : (mark?.state ?? "open");
    return { id, manual, state, mark };
  });
}
