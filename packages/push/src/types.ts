export type DevicePlatform = "web" | "ios" | "android";

/** Web Push subscription keys (the browser's `PushSubscription.toJSON().keys`). */
export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

/** What a phone or browser shows. Titles only: the customer's details load in the app after sign-in. */
export interface PushMessage {
  title: string;
  body: string;
  /** Portal path to open when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other (one per request). */
  tag: string;
  /** Urgent: sound and high priority, even when the phone is saving battery. */
  urgent: boolean;
}

export interface PushTarget {
  platform: DevicePlatform;
  /** APNs device token, FCM registration token, or the Web Push endpoint URL. */
  token: string;
  keys: WebPushKeys | null;
}

/**
 * sent: the provider accepted it. gone: the token is no longer valid (app removed, permission
 * revoked), so the device should be forgotten. failed: try later. unsupported: no provider is set
 * up for this kind of device.
 */
export type PushOutcome = { status: "sent" | "gone" | "unsupported" } | { status: "failed"; error: string };

/** Delivers to Apple (APNs), Google (FCM) or a browser (Web Push). */
export interface PushSender {
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
}

/** One HTTP exchange; injected in tests. */
export type HttpRequest = (request: {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; body: string }>;
