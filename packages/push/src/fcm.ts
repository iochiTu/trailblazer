import { signJwt } from "./jwt.js";
import type { HttpRequest, PushMessage, PushOutcome, PushTarget } from "./types.js";

/** The parts of a Firebase service account key (JSON) we use. */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/**
 * Android pushes through Firebase Cloud Messaging (HTTP v1 API). Signs in with the service
 * account (a short-lived OAuth token, reused until it nearly expires). The notification shows on
 * the "urgent" channel (sound, heads-up) or the "requests" channel; the app creates both.
 */
export class FcmSender {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: FcmServiceAccount,
    private readonly http: HttpRequest,
    private readonly now: () => number = Date.now,
  ) {}

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > this.now()) return this.accessToken.value;
    const iat = Math.floor(this.now() / 1000);
    const assertion = signJwt(
      "RS256",
      {},
      { iss: this.account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 },
      this.account.private_key,
    );
    const res = await this.http({
      url: TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (res.status !== 200) throw new Error(`FCM sign-in failed (${res.status}): ${res.body.slice(0, 200)}`);
    const data = JSON.parse(res.body) as { access_token: string; expires_in: number };
    this.accessToken = { value: data.access_token, expiresAt: this.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    let token: string;
    try {
      token = await this.token();
    } catch (error) {
      return { status: "failed", error: String(error instanceof Error ? error.message : error) };
    }
    const res = await this.http({
      url: `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token: target.token,
          notification: { title: message.title, body: message.body },
          data: { url: message.url, tag: message.tag },
          android: {
            priority: message.urgent ? "high" : "normal",
            collapse_key: message.tag,
            notification: {
              tag: message.tag,
              channel_id: message.urgent ? "urgent" : "requests",
              sound: "default",
            },
          },
        },
      }),
    });
    if (res.status === 200) return { status: "sent" };
    // The app was removed or the token replaced: forget the device.
    if (res.status === 404 || /UNREGISTERED/.test(res.body)) return { status: "gone" };
    if (res.status === 401) this.accessToken = null;
    return { status: "failed", error: `FCM ${res.status}: ${res.body.slice(0, 200)}` };
  }
}
