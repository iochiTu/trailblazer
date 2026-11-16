import webpush from "web-push";
import type { PushMessage, PushOutcome, PushTarget } from "./types.js";

export interface VapidConfig {
  /** "mailto:…" or an https URL push services can contact about our traffic. */
  subject: string;
  publicKey: string;
  privateKey: string;
}

type SendNotification = typeof webpush.sendNotification;

/**
 * Browsers and the installed PWA (Android, desktop; iOS once added to the home screen), through
 * the browser vendor's push service with our VAPID keys. The service worker (apps/admin/public/sw.js)
 * shows the notification and opens `url` when it's tapped.
 */
export class WebPushSender {
  constructor(
    private readonly vapid: VapidConfig,
    private readonly sendNotification: SendNotification = webpush.sendNotification,
  ) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    if (!target.keys) return { status: "gone" };
    try {
      await this.sendNotification({ endpoint: target.token, keys: target.keys }, JSON.stringify(message), {
        vapidDetails: this.vapid,
        TTL: message.urgent ? 3600 : 24 * 3600,
        urgency: message.urgent ? "high" : "normal",
        topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
      });
      return { status: "sent" };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // The subscription expired or the user turned notifications off.
      if (status === 404 || status === 410) return { status: "gone" };
      return {
        status: "failed",
        error: `Web Push ${status ?? ""}: ${String((error as Error).message)}`.trim(),
      };
    }
  }
}
