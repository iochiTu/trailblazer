import { signJwt } from "./jwt.js";
import type { HttpRequest, PushMessage, PushOutcome, PushTarget } from "./types.js";

export interface ApnsConfig {
  /** Key ID of the .p8 key (Apple Developer → Keys). */
  keyId: string;
  teamId: string;
  /** Contents of the .p8 file. */
  privateKey: string;
  /** The iOS app's bundle id, e.g. "com.traiblazer.app". */
  bundleId: string;
  /** "sandbox" for development builds from Xcode, "production" for TestFlight and the App Store. */
  environment: "production" | "sandbox";
}

/** Apple says to refresh the provider token between 20 and 60 minutes. */
const TOKEN_TTL_MS = 50 * 60_000;
/** Apple's reasons for a token that will never work again. */
const GONE_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

/**
 * iPhone pushes straight through Apple Push Notification service (token-based auth with a .p8
 * key; HTTP/2). Urgent requests are "time-sensitive", so they show through Focus modes.
 */
export class ApnsSender {
  private jwt: { value: string; createdAt: number } | null = null;

  constructor(
    private readonly config: ApnsConfig,
    private readonly http: HttpRequest,
    private readonly now: () => number = Date.now,
  ) {}

  private providerToken(): string {
    if (this.jwt && this.now() - this.jwt.createdAt < TOKEN_TTL_MS) return this.jwt.value;
    const value = signJwt(
      "ES256",
      { kid: this.config.keyId },
      { iss: this.config.teamId, iat: Math.floor(this.now() / 1000) },
      this.config.privateKey,
    );
    this.jwt = { value, createdAt: this.now() };
    return value;
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const host =
      this.config.environment === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
    const res = await this.http({
      url: `https://${host}/3/device/${encodeURIComponent(target.token)}`,
      method: "POST",
      headers: {
        authorization: `bearer ${this.providerToken()}`,
        "apns-topic": this.config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": message.urgent ? "10" : "5",
        "apns-collapse-id": message.tag.slice(0, 64),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        aps: {
          alert: { title: message.title, body: message.body },
          sound: "default",
          "thread-id": message.tag,
          "interruption-level": message.urgent ? "time-sensitive" : "active",
        },
        url: message.url,
      }),
    });
    if (res.status === 200) return { status: "sent" };
    let reason = "";
    try {
      reason = (JSON.parse(res.body) as { reason?: string }).reason ?? "";
    } catch {
      // not JSON
    }
    if (res.status === 410 || GONE_REASONS.has(reason)) return { status: "gone" };
    // An expired or refused provider token: make a new one next time.
    if (res.status === 403) this.jwt = null;
    return { status: "failed", error: `APNs ${res.status}${reason ? `: ${reason}` : ""}` };
  }
}
