/**
 * Connector contract. A connector knows how to talk to one outside system: how the business connects
 * its account and how to check the connection. Two kinds:
 *   - a CRM (Jobber, ServiceTitan, Housecall Pro, a webhook…) is handed the requests visitors leave;
 *   - a calendar (Google Calendar) gives the business's busy times and takes the appointments the
 *     assistant books.
 *
 * Connectors hold no state and never touch the database. The platform stores each business's
 * credentials encrypted (`integration_connections`), opens them only to call a connector, and saves
 * whatever the connector hands back (refreshed tokens). To add a CRM: write a connector in
 * connectors/, add it to registry.ts, and add an add-on for it in @traiblazer/addons (crmAddon).
 */

/** Text shown to business owners, in the admin portal's languages. */
export interface Localized {
  en: string;
  fr: string;
}

/** What a business saves to connect: API keys, OAuth tokens, account ids. Always stored encrypted. */
export type Credentials = Record<string, string>;

/** Something the owner types to connect (connectors with `auth: "fields"`). */
export interface CredentialField {
  key: string;
  label: Localized;
  hint?: Localized;
  /** Shown as a password box. No credential, secret or not, is ever sent back to the portal. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  maxLength?: number;
}

/** Keys the platform itself holds for a CRM (our developer app), from the environment. */
export interface PlatformKeys {
  jobber?: { clientId: string; clientSecret: string };
  google?: { clientId: string; clientSecret: string };
  serviceTitan?: { appKey: string; environment: "production" | "integration" };
}

/** A visitor's request, ready to hand to a CRM. */
export interface CrmLead {
  /** Our id for the request: sent as the external reference so a CRM can spot repeats. */
  id: string;
  /** "callback", "quote", "booking", "question", "complaint" or "other". */
  kind: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** When or how the visitor prefers to be reached, in their words. */
  bestTime: string | null;
  /** What the visitor wants, summarised by the assistant. */
  message: string;
  /** Language the visitor wrote in (BCP 47), when known. */
  language: string | null;
  urgent: boolean;
  /** Industry details the visitor gave (vehicle, address…), labelled in the owner's language. */
  details: { key: string; label: string; value: string }[];
  photoCount: number;
  createdAt: Date;
  businessName: string;
  /** Language the business owner reads: notes written into the CRM use it. */
  ownerLanguage: "en" | "fr";
  /** Link to the request in the admin portal, when the portal's address is known. */
  requestUrl: string | null;
}

export interface ConnectorContext {
  credentials: Credentials;
  platform: PlatformKeys;
  /** Outbound HTTP. The platform passes one that refuses private addresses; tests pass a fake. */
  fetch: typeof fetch;
  now?: () => Date;
}

export interface VerifyResult {
  /** The connected account's name, shown to the owner ("Connected to Maple Plumbing"). */
  accountName: string | null;
}

export interface PushResult {
  /** The CRM's id for what was created. */
  externalId: string | null;
  /** Where staff can open it in the CRM. */
  externalUrl: string | null;
}

/** OAuth 2.0 authorization-code flow, for services where the owner signs in instead of pasting keys. */
export interface OAuthFlow {
  authorizeUrl(input: { platform: PlatformKeys; redirectUri: string; state: string }): string;
  exchangeCode(input: {
    platform: PlatformKeys;
    fetch: typeof fetch;
    code: string;
    redirectUri: string;
    now?: () => Date;
  }): Promise<Credentials>;
}

/** What every connector has, whatever it is for. */
export interface Connector {
  /** Stable id, stored with each connection. Never change it once released. */
  id: string;
  /** Product name (not translated). */
  name: string;
  /** "crm": requests are handed to it. "calendar": the assistant reads free times and books in it. */
  kind: "crm" | "calendar";
  /** "fields": the owner pastes keys. "oauth2": the owner signs in at the service. */
  auth: "fields" | "oauth2";
  fields: CredentialField[];
  oauth?: OAuthFlow;
  /** False while the platform's own keys for this service are missing (e.g. no Jobber developer app yet). */
  ready(platform: PlatformKeys): boolean;
  /**
   * New credentials when the saved ones have expired or are about to (access tokens), else null.
   * Called with the connection locked, so two jobs never refresh the same token at once.
   */
  refresh?(ctx: ConnectorContext): Promise<Credentials | null>;
  /** Checks the credentials with a cheap call. Throws ConnectorError when they don't work. */
  verify(ctx: ConnectorContext): Promise<VerifyResult>;
}

export interface CrmConnector extends Connector {
  kind: "crm";
  /** Hands a request to the CRM. Throws ConnectorError on failure. */
  pushLead(ctx: ConnectorContext, lead: CrmLead): Promise<PushResult>;
}

/** A time the calendar is taken (start inclusive, end exclusive). */
export interface BusyTime {
  start: Date;
  end: Date;
}

/** An appointment the assistant books. */
export interface CalendarEvent {
  /** Our id for the booking: the calendar uses it so a retried call never books twice. */
  id: string;
  start: Date;
  end: Date;
  /** IANA time zone the business works in, shown with the event. */
  timeZone: string;
  title: string;
  /** The visitor's details and request, for the business. */
  description: string;
}

export interface CalendarConnector extends Connector {
  kind: "calendar";
  /** When the business's calendar is taken between two moments. Throws ConnectorError on failure. */
  busyTimes(ctx: ConnectorContext, range: { from: Date; to: Date }): Promise<BusyTime[]>;
  /** Puts an appointment in the calendar. Safe to call twice with the same event id. */
  createEvent(ctx: ConnectorContext, event: CalendarEvent): Promise<PushResult>;
}

export type AnyConnector = CrmConnector | CalendarConnector;

/**
 * Why a call to a connected service failed, which decides what happens next:
 *   - "auth": the credentials no longer work. The connection is flagged for the owner; no retry.
 *   - "rejected": the service refused this request (bad data, missing setting). No retry.
 *   - "temporary": outage, timeout or rate limit. The job is retried with backoff.
 */
export type ConnectorFailure = "auth" | "rejected" | "temporary";

export class ConnectorError extends Error {
  constructor(
    public readonly failure: ConnectorFailure,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
