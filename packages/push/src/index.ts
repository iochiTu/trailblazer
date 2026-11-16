import { readFileSync } from "node:fs";
import { type ClientHttp2Session, connect } from "node:http2";
import { ApnsSender } from "./apns.js";
import { FcmSender, type FcmServiceAccount } from "./fcm.js";
import { pemFromEnv } from "./jwt.js";
import type { HttpRequest, PushMessage, PushOutcome, PushSender, PushTarget } from "./types.js";
import { WebPushSender } from "./web.js";

export { type ApnsConfig, ApnsSender } from "./apns.js";
export { FcmSender, type FcmServiceAccount } from "./fcm.js";
export { signJwt } from "./jwt.js";
export * from "./types.js";
export { type VapidConfig, WebPushSender } from "./web.js";

/** HTTP/1.1 through fetch (Google's endpoints). */
export const fetchRequest: HttpRequest = async ({ url, method, headers, body }) => {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: await res.text() };
};

/** HTTP/2 (Apple requires it), one connection per host kept open between pushes. */
export function http2Request(): HttpRequest {
  const sessions = new Map<string, ClientHttp2Session>();
  const session = (origin: string) => {
    const open = sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const created = connect(origin);
    created.on("error", () => sessions.delete(origin));
    created.on("close", () => sessions.delete(origin));
    created.unref();
    sessions.set(origin, created);
    return created;
  };
  return ({ url, method, headers, body }) =>
    new Promise((resolve, reject) => {
      const { origin, pathname } = new URL(url);
      const req = session(origin).request({ ":method": method, ":path": pathname, ...headers });
      let status = 0;
      let data = "";
      req.setEncoding("utf8");
      req.setTimeout(15_000, () => req.close());
      req.on("response", (h) => {
        status = Number(h[":status"]);
      });
      req.on("data", (chunk: string) => {
        data += chunk;
      });
      req.on("end", () =>
        status ? resolve({ status, body: data }) : reject(new Error("APNs: no response")),
      );
      req.on("error", reject);
      req.end(body);
    });
}

/** Sends each device to its platform's provider; a platform with no provider set up is "unsupported". */
export class RoutingPushSender implements PushSender {
  constructor(private readonly senders: Partial<Record<PushTarget["platform"], PushSender>>) {}
  get platforms() {
    return Object.keys(this.senders) as PushTarget["platform"][];
  }
  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const sender = this.senders[target.platform];
    return sender ? sender.send(target, message) : { status: "unsupported" };
  }
}

/**
 * Push providers from the environment (each optional; docs in apps/mobile/README.md):
 * - Web Push: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (`npx web-push generate-vapid-keys`)
 * - Android (FCM): FCM_SERVICE_ACCOUNT (the JSON key) or FCM_SERVICE_ACCOUNT_FILE (its path)
 * - iPhone (APNs): APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (.p8 contents), APNS_BUNDLE_ID,
 *   APNS_ENVIRONMENT (production | sandbox; default production)
 */
export function createPushFromEnv(env: NodeJS.ProcessEnv = process.env): RoutingPushSender {
  const senders: Partial<Record<PushTarget["platform"], PushSender>> = {};
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    senders.web = new WebPushSender({
      subject: env.VAPID_SUBJECT ?? "mailto:notifications@traiblazer.local",
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
  }
  const fcmJson =
    env.FCM_SERVICE_ACCOUNT ??
    (env.FCM_SERVICE_ACCOUNT_FILE ? readFileSync(env.FCM_SERVICE_ACCOUNT_FILE, "utf8") : undefined);
  if (fcmJson) {
    const account = JSON.parse(fcmJson) as FcmServiceAccount;
    senders.android = new FcmSender(
      { ...account, private_key: pemFromEnv(account.private_key) },
      fetchRequest,
    );
  }
  if (env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY && env.APNS_BUNDLE_ID) {
    senders.ios = new ApnsSender(
      {
        keyId: env.APNS_KEY_ID,
        teamId: env.APNS_TEAM_ID,
        privateKey: pemFromEnv(env.APNS_PRIVATE_KEY),
        bundleId: env.APNS_BUNDLE_ID,
        environment: env.APNS_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
      },
      http2Request(),
    );
  }
  return new RoutingPushSender(senders);
}
