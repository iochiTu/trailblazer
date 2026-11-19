import { requestJson } from "../http.js";
import { oauthTokens } from "../oauth.js";
import {
  type BusyTime,
  type CalendarConnector,
  type ConnectorContext,
  ConnectorError,
  type Credentials,
  type PlatformKeys,
} from "../types.js";

/**
 * Google Calendar (https://developers.google.com/calendar/api): the owner signs in with Google, then
 * the assistant reads when the business's main calendar is busy (freeBusy) and puts the appointments
 * it books there (events.insert).
 *
 * Access is the least that does the job: free/busy only (no event titles or details are read) and
 * events (to add appointments), plus the account's email address to show which calendar is connected.
 * Google treats the events scope as sensitive: the platform's OAuth app needs Google's verification
 * before it is opened to every business (until then, only test users added to the app can connect).
 *
 * Access tokens last an hour; the refresh token Google gives with `access_type=offline` stays the same
 * until the owner removes access (Google may still return a new one, which is then kept).
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
];

const keys = (platform: PlatformKeys) => {
  if (!platform.google) throw new ConnectorError("rejected", "Google is not set up on this platform yet");
  return platform.google;
};

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function toCredentials(token: TokenResponse | null, now: Date, previous?: Credentials): Credentials {
  if (!token?.access_token) throw new ConnectorError("auth", "Google did not return an access token");
  const refreshToken = token.refresh_token ?? previous?.refreshToken;
  if (!refreshToken) {
    throw new ConnectorError(
      "auth",
      "Google did not give lasting access to the calendar. Please connect again.",
    );
  }
  // The owner can untick a permission on Google's consent screen: both are needed to book. (A
  // refresh answer has no scope check to make: it carries what was granted at sign-in.)
  if (token.scope && !previous) {
    const granted = new Set(token.scope.split(/\s+/));
    if (!GOOGLE_CALENDAR_SCOPES.slice(2).every((s) => granted.has(s))) {
      throw new ConnectorError(
        "rejected",
        "Google Calendar needs both permissions (see when you're busy, and add appointments). Please connect again and keep both ticked.",
      );
    }
  }
  return {
    accessToken: token.access_token,
    refreshToken,
    expiresAt: String(now.getTime() + (token.expires_in ?? 3600) * 1000),
  };
}

const tokens = oauthTokens<TokenResponse>({
  service: "Google",
  connection: "Google Calendar",
  tokenUrl: TOKEN_URL,
  keys,
  toCredentials,
});

const auth = (ctx: ConnectorContext) => ({ authorization: `Bearer ${ctx.credentials.accessToken ?? ""}` });

/**
 * A Google event id made from our booking id: Google accepts 5–1024 characters from a–v and 0–9
 * (base32hex), and a UUID's hex digits are all in that set. Sending the same id twice is refused
 * with 409, so a retried booking never shows up twice in the calendar.
 */
export const googleEventId = (bookingId: string) => `tb${bookingId.replace(/-/g, "").toLowerCase()}`;

interface FreeBusyResponse {
  calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }>;
}

export const googleCalendar: CalendarConnector = {
  id: "google-calendar",
  name: "Google Calendar",
  kind: "calendar",
  auth: "oauth2",
  fields: [],
  ready: (platform) => !!platform.google,

  oauth: {
    authorizeUrl({ platform, redirectUri, state }) {
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: keys(platform).clientId,
        redirect_uri: redirectUri,
        scope: GOOGLE_CALENDAR_SCOPES.join(" "),
        state,
        // A refresh token, so the assistant can book while the owner is away.
        access_type: "offline",
        // Asked every time: Google only gives a refresh token on consent.
        prompt: "consent",
        include_granted_scopes: "true",
      }).toString();
      return url.toString();
    },
    exchangeCode: tokens.exchangeCode,
  },

  refresh: tokens.refresh,

  async verify(ctx) {
    const me = await requestJson<{ email?: string }>(ctx.fetch, "Google", USERINFO_URL, {
      headers: auth(ctx),
    });
    // The calendar itself must answer too: a missing permission shows here, not at the first booking.
    const now = ctx.now?.() ?? new Date();
    await googleCalendar.busyTimes(ctx, { from: now, to: new Date(now.getTime() + 60 * 60_000) });
    return { accountName: me?.email ?? null };
  },

  async busyTimes(ctx, { from, to }) {
    const res = await requestJson<FreeBusyResponse>(ctx.fetch, "Google", `${CALENDAR_API}/freeBusy`, {
      headers: auth(ctx),
      json: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] },
    });
    const calendar = res?.calendars?.primary;
    if (!calendar) throw new ConnectorError("temporary", "Google sent no free/busy times");
    if (calendar.errors?.length) {
      const reasons = calendar.errors.map((e) => e.reason ?? "error").join(", ");
      const temporary = calendar.errors.some(
        (e) => e.reason === "backendError" || e.reason === "internalError",
      );
      throw new ConnectorError(temporary ? "temporary" : "rejected", `Google Calendar: ${reasons}`);
    }
    const busy: BusyTime[] = [];
    for (const slot of calendar.busy ?? []) {
      const start = new Date(slot.start);
      const end = new Date(slot.end);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start)
        busy.push({ start, end });
    }
    return busy;
  },

  async createEvent(ctx, event) {
    const id = googleEventId(event.id);
    const url = `${CALENDAR_API}/calendars/primary/events`;
    try {
      const made = await requestJson<{ id?: string; htmlLink?: string }>(
        ctx.fetch,
        "Google",
        // Nobody is invited, so Google sends no email: the business tells the customer itself.
        `${url}?sendUpdates=none`,
        {
          headers: auth(ctx),
          json: {
            id,
            summary: event.title,
            description: event.description,
            start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
            end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
            // Shows as busy, so the next visitor isn't offered the same time.
            transparency: "opaque",
          },
        },
      );
      return { externalId: made?.id ?? id, externalUrl: made?.htmlLink ?? null };
    } catch (error) {
      // Already there: an earlier try made it before its answer was lost.
      if (error instanceof ConnectorError && error.status === 409)
        return { externalId: id, externalUrl: null };
      throw error;
    }
  },
};
