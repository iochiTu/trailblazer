import { requestJson } from "../http.js";
import { leadNotes, leadTitle, phoneDigits, splitName } from "../lead-text.js";
import {
  type ConnectorContext,
  ConnectorError,
  type Credentials,
  type CrmConnector,
  type PlatformKeys,
} from "../types.js";

/**
 * Jobber (https://developer.getjobber.com/docs): OAuth 2.0 sign-in, then GraphQL.
 *
 * A request from a visitor becomes a Jobber *request* on a client: the client is found by email
 * or phone, or created (Jobber records our app as the client's lead source), and the visitor's
 * details go in a note on the request.
 *
 * Access tokens last 60 minutes and refresh tokens rotate: each refresh returns a new refresh
 * token and cancels the old one, so the platform saves what `refresh` returns before using it.
 *
 * Checked against the public docs: OAuth, the endpoint and headers, clientCreate, the account
 * query, jobberWebUri. NOT yet checked against a live account (Jobber's full schema is only shown
 * to signed-in developers): the `phones` input, `clients(searchTerm:)`, `requestCreate` and
 * `requestCreateNote`. Run them once in the Developer Center's GraphiQL before selling this.
 */

const AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
/** Jobber supports each API version for at least 12 months; bump this when the changelog says so. */
export const JOBBER_API_VERSION = "2026-09-25";
/** Refresh this long before the access token runs out. */
const REFRESH_MARGIN_MS = 5 * 60_000;

const keys = (platform: PlatformKeys) => {
  if (!platform.jobber) throw new ConnectorError("rejected", "Jobber is not set up on this platform yet");
  return platform.jobber;
};

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

function toCredentials(token: TokenResponse | null, now: Date, previous?: Credentials): Credentials {
  if (!token?.access_token) throw new ConnectorError("auth", "Jobber did not return an access token");
  return {
    accessToken: token.access_token,
    // Rotation is the default; an app without it keeps its refresh token.
    refreshToken: token.refresh_token ?? previous?.refreshToken ?? "",
    expiresAt: String(now.getTime() + (token.expires_in ?? 3600) * 1000),
  };
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string } }[];
}

interface UserError {
  message: string;
  path?: string[];
}

async function graphql<T>(ctx: ConnectorContext, query: string, variables: Record<string, unknown> = {}) {
  const res = await requestJson<GraphqlResponse<T>>(ctx.fetch, "Jobber", GRAPHQL_URL, {
    headers: {
      authorization: `Bearer ${ctx.credentials.accessToken ?? ""}`,
      "x-jobber-graphql-version": JOBBER_API_VERSION,
    },
    json: { query, variables },
  });
  // Jobber answers 200 with `errors` for throttling and for queries it refuses.
  if (res?.errors?.length) {
    const throttled = res.errors.some((e) => e.extensions?.code === "THROTTLED");
    throw new ConnectorError(
      throttled ? "temporary" : "rejected",
      `Jobber: ${res.errors.map((e) => e.message).join("; ")}`.slice(0, 300),
    );
  }
  if (!res?.data) throw new ConnectorError("temporary", "Jobber sent an empty answer");
  return res.data;
}

/** Errors Jobber reports about the input itself (a missing field, a bad email). */
function assertNoUserErrors(what: string, errors: UserError[] | undefined) {
  if (errors?.length) {
    throw new ConnectorError(
      "rejected",
      `Jobber could not ${what}: ${errors.map((e) => e.message).join("; ")}`.slice(0, 300),
    );
  }
}

const FIND_CLIENT = `query FindClient($term: String!) {
  clients(first: 5, searchTerm: $term) { nodes { id emails { address } phones { number } } }
}`;

const CREATE_CLIENT = `mutation CreateClient($input: ClientCreateInput!) {
  clientCreate(input: $input) { client { id } userErrors { message path } }
}`;

const CREATE_REQUEST = `mutation CreateRequest($input: RequestCreateInput!) {
  requestCreate(input: $input) { request { id jobberWebUri } userErrors { message path } }
}`;

const CREATE_NOTE = `mutation CreateRequestNote($requestId: EncodedId!, $input: RequestCreateNoteInput!) {
  requestCreateNote(requestId: $requestId, input: $input) { userErrors { message path } }
}`;

interface ClientNode {
  id: string;
  emails?: { address?: string }[];
  phones?: { number?: string }[];
}

/** An existing client with exactly this email or phone (a search term alone also matches names). */
async function findClient(ctx: ConnectorContext, email: string | null, phone: string | null) {
  const wantedPhone = phone ? phoneDigits(phone).replace(/^\+?1(?=\d{10}$)/, "") : null;
  for (const term of [email, phone]) {
    if (!term) continue;
    const data = await graphql<{ clients: { nodes: ClientNode[] } }>(ctx, FIND_CLIENT, { term });
    const match = data.clients.nodes.find(
      (c) =>
        (email && c.emails?.some((e) => e.address?.toLowerCase() === email.toLowerCase())) ||
        (wantedPhone &&
          c.phones?.some((p) => phoneDigits(p.number ?? "").replace(/^\+?1(?=\d{10}$)/, "") === wantedPhone)),
    );
    if (match) return match.id;
  }
  return null;
}

export const jobber: CrmConnector = {
  id: "jobber",
  name: "Jobber",
  auth: "oauth2",
  fields: [],
  ready: (platform) => !!platform.jobber,

  oauth: {
    // Scopes are set on the app in Jobber's Developer Center, not in the address.
    authorizeUrl({ platform, redirectUri, state }) {
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: keys(platform).clientId,
        redirect_uri: redirectUri,
        state,
      }).toString();
      return url.toString();
    },
    async exchangeCode({ platform, fetch, code, redirectUri, now }) {
      const { clientId, clientSecret } = keys(platform);
      const token = await requestJson<TokenResponse>(fetch, "Jobber", TOKEN_URL, {
        form: {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        },
      });
      return toCredentials(token, now?.() ?? new Date());
    },
  },

  async refresh(ctx) {
    const now = ctx.now?.() ?? new Date();
    if (Number(ctx.credentials.expiresAt ?? 0) - now.getTime() > REFRESH_MARGIN_MS) return null;
    if (!ctx.credentials.refreshToken) {
      throw new ConnectorError("auth", "The Jobber connection has expired. Please connect again.");
    }
    const { clientId, clientSecret } = keys(ctx.platform);
    let token: TokenResponse | null;
    try {
      token = await requestJson<TokenResponse>(ctx.fetch, "Jobber", TOKEN_URL, {
        form: {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: ctx.credentials.refreshToken,
        },
      });
    } catch (error) {
      // A refused refresh token (400 invalid_grant, 401) means the owner disconnected or must sign in again.
      if (error instanceof ConnectorError && error.failure !== "temporary") {
        throw new ConnectorError(
          "auth",
          "Jobber no longer accepts this connection. Please connect again.",
          error.status,
        );
      }
      throw error;
    }
    return toCredentials(token, now, ctx.credentials);
  },

  async verify(ctx) {
    const data = await graphql<{ account: { id: string; name: string } }>(
      ctx,
      "query { account { id name } }",
    );
    return { accountName: data.account?.name ?? null };
  },

  async pushLead(ctx, lead) {
    let clientId = await findClient(ctx, lead.email, lead.phone);
    if (!clientId) {
      const { first, last } = splitName(lead.name);
      const created = await graphql<{
        clientCreate: { client: { id: string } | null; userErrors: UserError[] };
      }>(ctx, CREATE_CLIENT, {
        input: {
          firstName: first,
          lastName: last,
          ...(lead.email ? { emails: [{ description: "MAIN", primary: true, address: lead.email }] } : {}),
          ...(lead.phone ? { phones: [{ description: "MAIN", primary: true, number: lead.phone }] } : {}),
        },
      });
      assertNoUserErrors("create the client", created.clientCreate.userErrors);
      clientId = created.clientCreate.client?.id ?? null;
      if (!clientId) throw new ConnectorError("rejected", "Jobber did not create the client");
    }

    const request = await graphql<{
      requestCreate: { request: { id: string; jobberWebUri?: string } | null; userErrors: UserError[] };
    }>(ctx, CREATE_REQUEST, { input: { clientId, title: leadTitle(lead) } });
    assertNoUserErrors("create the request", request.requestCreate.userErrors);
    const made = request.requestCreate.request;
    if (!made) throw new ConnectorError("rejected", "Jobber did not create the request");

    const note = await graphql<{ requestCreateNote: { userErrors: UserError[] } }>(ctx, CREATE_NOTE, {
      requestId: made.id,
      input: { message: leadNotes(lead) },
    });
    assertNoUserErrors("add the visitor's details to the request", note.requestCreateNote.userErrors);

    return { externalId: made.id, externalUrl: made.jobberWebUri ?? null };
  },
};
