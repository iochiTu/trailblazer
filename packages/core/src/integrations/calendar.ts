import type { WeeklyHours } from "@traiblazer/db";
import {
  type BusyTime,
  type CalendarConnector,
  type CalendarEvent,
  type ConnectorContext,
  ConnectorError,
  getCalendarConnector,
  type PushResult,
} from "@traiblazer/integrations";
import { publicFetch } from "../knowledge/safe-fetch.js";
import { type ConnectionDeps, type ConnectionRef, openCredentials, recordOutcome } from "./connections.js";

/**
 * What the booking tools see of a business's calendar: its settings, and two calls (busy times,
 * book) that open the connection's credentials, refresh them when needed, and note how it went.
 * Both throw ConnectorError when the calendar can't be used.
 */
export interface CalendarAccess {
  provider: string;
  /** Product name, e.g. "Google Calendar". */
  name: string;
  timeZone: string;
  hours: WeeklyHours | null;
  durationMinutes: number;
  noticeMinutes: number;
  daysAhead: number;
  busyTimes(range: { from: Date; to: Date }): Promise<BusyTime[]>;
  createEvent(event: CalendarEvent): Promise<PushResult>;
}

export function calendarAccess(
  deps: ConnectionDeps,
  ref: ConnectionRef,
  settings: Pick<CalendarAccess, "timeZone" | "hours" | "durationMinutes" | "noticeMinutes" | "daysAhead">,
): CalendarAccess | null {
  const found = getCalendarConnector(ref.provider);
  if (!found || !deps.integrations.secretKey || !found.ready(deps.integrations.platform)) return null;
  const connector: CalendarConnector = found;

  /** Runs one call with fresh credentials; refused credentials flag the connection for the owner. */
  async function call<T>(run: (ctx: ConnectorContext) => Promise<T>): Promise<T> {
    const opened = await openCredentials(deps, connector, ref);
    if (opened.state === "missing") throw new ConnectorError("auth", `${connector.name} is not connected`);
    if (opened.state === "failed") {
      await recordOutcome(deps, ref, opened.error);
      throw opened.error;
    }
    try {
      return await run({
        credentials: opened.credentials,
        platform: deps.integrations.platform,
        fetch: deps.fetch ?? publicFetch,
      });
    } catch (error) {
      if (error instanceof ConnectorError) await recordOutcome(deps, ref, error);
      throw error;
    }
  }

  return {
    provider: connector.id,
    name: connector.name,
    ...settings,
    busyTimes: (range) => call((ctx) => connector.busyTimes(ctx, range)),
    async createEvent(event) {
      const result = await call((ctx) => connector.createEvent(ctx, event));
      await recordOutcome(deps, ref, null);
      return result;
    },
  };
}
