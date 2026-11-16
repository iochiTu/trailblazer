import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApnsSender } from "./apns.js";
import { FcmSender } from "./fcm.js";
import { createPushFromEnv, RoutingPushSender } from "./index.js";
import type { HttpRequest, PushMessage } from "./types.js";
import { WebPushSender } from "./web.js";

const message: PushMessage = {
  title: "Urgent request · Smith Plumbing",
  body: "A customer needs help now. Tap to call them back.",
  url: "/t/t1/inbox/b1/l1",
  tag: "request-l1",
  urgent: true,
};

type Call = Parameters<HttpRequest>[0];
/** Answers each request with the next canned response and records it. */
function fakeHttp(...responses: { status: number; body?: string }[]) {
  const calls: Call[] = [];
  const http: HttpRequest = async (request) => {
    calls.push(request);
    const next = responses.shift() ?? { status: 200 };
    return { status: next.status, body: next.body ?? "" };
  };
  return { calls, http };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

describe("APNs", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const config = {
    keyId: "KEY123",
    teamId: "TEAM456",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    bundleId: "com.traiblazer.app",
    environment: "production" as const,
  };

  it("sends a time-sensitive alert with a valid ES256 provider token", async () => {
    const { calls, http } = fakeHttp({ status: 200 });
    const sender = new ApnsSender(config, http);
    expect(await sender.send({ platform: "ios", token: "abc123", keys: null }, message)).toEqual({
      status: "sent",
    });
    const call = calls[0]!;
    expect(call.url).toBe("https://api.push.apple.com/3/device/abc123");
    expect(call.headers).toMatchObject({
      "apns-topic": "com.traiblazer.app",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": "request-l1",
    });
    expect(JSON.parse(call.body)).toEqual({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: "default",
        "thread-id": "request-l1",
        "interruption-level": "time-sensitive",
      },
      url: "/t/t1/inbox/b1/l1",
    });
    const jwt = call.headers.authorization!.replace("bearer ", "");
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header!)).toEqual({ alg: "ES256", typ: "JWT", kid: "KEY123" });
    expect(decode(claims!)).toMatchObject({ iss: "TEAM456" });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("reuses the provider token, and tells a dead token from a passing failure", async () => {
    const { calls, http } = fakeHttp(
      { status: 410, body: '{"reason":"Unregistered"}' },
      { status: 400, body: '{"reason":"BadDeviceToken"}' },
      { status: 429, body: '{"reason":"TooManyRequests"}' },
    );
    const sender = new ApnsSender({ ...config, environment: "sandbox" }, http);
    const target = { platform: "ios" as const, token: "t", keys: null };
    expect(await sender.send(target, { ...message, urgent: false })).toEqual({ status: "gone" });
    expect(await sender.send(target, message)).toEqual({ status: "gone" });
    expect(await sender.send(target, message)).toEqual({
      status: "failed",
      error: "APNs 429: TooManyRequests",
    });
    expect(calls[0]!.url).toContain("api.sandbox.push.apple.com");
    expect(calls[0]!.headers["apns-priority"]).toBe("5");
    expect(new Set(calls.map((c) => c.headers.authorization)).size).toBe(1);
  });
});

describe("FCM", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = {
    project_id: "traiblazer-app",
    client_email: "push@traiblazer-app.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };

  it("signs in once, then sends on the urgent channel", async () => {
    const { calls, http } = fakeHttp(
      { status: 200, body: JSON.stringify({ access_token: "ya29.token", expires_in: 3600 }) },
      { status: 200, body: "{}" },
      { status: 200, body: "{}" },
    );
    const sender = new FcmSender(account, http);
    const target = { platform: "android" as const, token: "fcm-token", keys: null };
    expect(await sender.send(target, message)).toEqual({ status: "sent" });
    expect(await sender.send(target, { ...message, urgent: false })).toEqual({ status: "sent" });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(calls[0]!.body).get("assertion")!;
    expect(decode(assertion.split(".")[1]!)).toMatchObject({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });
    expect(calls[1]!.url).toBe("https://fcm.googleapis.com/v1/projects/traiblazer-app/messages:send");
    expect(calls[1]!.headers.authorization).toBe("Bearer ya29.token");
    expect(JSON.parse(calls[1]!.body).message).toEqual({
      token: "fcm-token",
      notification: { title: message.title, body: message.body },
      data: { url: message.url, tag: message.tag },
      android: {
        priority: "high",
        collapse_key: "request-l1",
        notification: { tag: "request-l1", channel_id: "urgent", sound: "default" },
      },
    });
    expect(JSON.parse(calls[2]!.body).message.android.notification.channel_id).toBe("requests");
  });

  it("forgets unregistered tokens and reports a failed sign-in", async () => {
    const { http } = fakeHttp(
      { status: 200, body: JSON.stringify({ access_token: "a", expires_in: 3600 }) },
      { status: 404, body: '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}' },
    );
    const target = { platform: "android" as const, token: "x", keys: null };
    expect(await new FcmSender(account, http).send(target, message)).toEqual({ status: "gone" });
    const refused = fakeHttp({ status: 400, body: "invalid_grant" });
    const outcome = await new FcmSender(account, refused.http).send(target, message);
    expect(outcome).toMatchObject({ status: "failed" });
  });
});

describe("Web Push", () => {
  const vapid = { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" };
  const target = {
    platform: "web" as const,
    token: "https://push.example/sub/1",
    keys: { p256dh: "p", auth: "a" },
  };

  it("sends the message for the service worker with high urgency", async () => {
    const sent: unknown[][] = [];
    const sender = new WebPushSender(vapid, (async (...args: unknown[]) => {
      sent.push(args);
      return { statusCode: 201, body: "", headers: {} };
    }) as never);
    expect(await sender.send(target, message)).toEqual({ status: "sent" });
    expect(sent[0]![0]).toEqual({ endpoint: target.token, keys: target.keys });
    expect(JSON.parse(sent[0]![1] as string)).toEqual(message);
    expect(sent[0]![2]).toMatchObject({ vapidDetails: vapid, urgency: "high", topic: "request-l1" });
  });

  it("forgets expired subscriptions", async () => {
    const fail = (statusCode: number) =>
      new WebPushSender(vapid, (async () => {
        throw Object.assign(new Error("push service said no"), { statusCode });
      }) as never);
    expect(await fail(410).send(target, message)).toEqual({ status: "gone" });
    expect(await fail(500).send(target, message)).toMatchObject({ status: "failed" });
    expect(await fail(500).send({ ...target, keys: null }, message)).toEqual({ status: "gone" });
  });
});

describe("routing", () => {
  it("sets up only the providers that are configured", async () => {
    expect(createPushFromEnv({}).platforms).toEqual([]);
    expect(createPushFromEnv({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" }).platforms).toEqual(["web"]);
    const router = new RoutingPushSender({});
    expect(await router.send({ platform: "ios", token: "t", keys: null }, message)).toEqual({
      status: "unsupported",
    });
  });
});
