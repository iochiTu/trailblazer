import { requestJson } from "./http.js";
import {
  type ConnectorContext,
  ConnectorError,
  type Credentials,
  type OAuthFlow,
  type PlatformKeys,
} from "./types.js";

/** Refresh this long before the access token runs out. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * The token half of the OAuth 2.0 authorization-code flow, the same for every connector that signs
 * in this way: trading the code for tokens, and refreshing the access token shortly before it runs
 * out. `service` names the provider in errors ("Google"), `connection` the connection ("Google
 * Calendar"). `toCredentials` gets the saved credentials as `previous` when refreshing.
 */
export function oauthTokens<Token>(options: {
  service: string;
  connection: string;
  tokenUrl: string;
  keys: (platform: PlatformKeys) => { clientId: string; clientSecret: string };
  toCredentials: (token: Token | null, now: Date, previous?: Credentials) => Credentials;
}): Pick<OAuthFlow, "exchangeCode"> & { refresh(ctx: ConnectorContext): Promise<Credentials | null> } {
  const request = (fetch: typeof globalThis.fetch, platform: PlatformKeys, form: Record<string, string>) => {
    const { clientId, clientSecret } = options.keys(platform);
    return requestJson<Token>(fetch, options.service, options.tokenUrl, {
      form: { client_id: clientId, client_secret: clientSecret, ...form },
    });
  };

  return {
    async exchangeCode({ platform, fetch, code, redirectUri, now }) {
      const token = await request(fetch, platform, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
      return options.toCredentials(token, now?.() ?? new Date());
    },

    async refresh(ctx) {
      const now = ctx.now?.() ?? new Date();
      if (Number(ctx.credentials.expiresAt ?? 0) - now.getTime() > REFRESH_MARGIN_MS) return null;
      if (!ctx.credentials.refreshToken) {
        throw new ConnectorError(
          "auth",
          `The ${options.connection} connection has expired. Please connect again.`,
        );
      }
      let token: Token | null;
      try {
        token = await request(ctx.fetch, ctx.platform, {
          grant_type: "refresh_token",
          refresh_token: ctx.credentials.refreshToken,
        });
      } catch (error) {
        // A refused refresh token (400 invalid_grant, 401): the owner removed access, changed their
        // password, or must sign in again.
        if (error instanceof ConnectorError && error.failure !== "temporary") {
          throw new ConnectorError(
            "auth",
            `${options.service} no longer accepts this connection. Please connect again.`,
            error.status,
          );
        }
        throw error;
      }
      return options.toCredentials(token, now, ctx.credentials);
    },
  };
}
