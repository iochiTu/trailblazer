"use client";

/**
 * Push notifications on this device (PLAN §20.3), the same calls in a browser and in the iOS /
 * Android owner app:
 * - In the app (the Capacitor shell, apps/mobile, loading the portal), the PushNotifications
 *   plugin gives an APNs (iPhone) or FCM (Android) token.
 * - In a browser or the installed PWA, the service worker subscribes with our VAPID key.
 * Either way the token goes to POST /v1/me/devices, tied to this sign-in.
 */
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "@/lib/api";

const DEVICE_KEY = "tb_push_device";

type NativePush = typeof PushNotifications;
type Listener = { remove: () => Promise<void> };

/** The plugin, inside the app only (in a browser the portal uses Web Push). */
const nativePush = (): NativePush | null => (Capacitor.isNativePlatform() ? PushNotifications : null);
const nativePlatform = () => Capacitor.getPlatform() as "ios" | "android";

/** Where notifications can come from on this device. */
export type PushSupport =
  /** The iOS / Android app. */
  | "native"
  /** A browser or installed PWA with Web Push. */
  | "web"
  /** iPhone Safari: Web Push only works once the portal is added to the Home Screen (or use the app). */
  | "ios-install"
  | "unsupported";

export async function pushSupport(): Promise<PushSupport> {
  if (nativePush()) return "native";
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  if (!("PushManager" in window)) return ios && !standalone ? "ios-install" : "unsupported";
  const { webPushPublicKey } = await api<{ webPushPublicKey: string | null }>("/v1/push/config");
  return webPushPublicKey ? "web" : "unsupported";
}

export type PushState = "on" | "off" | "denied";

const storedDevice = () => {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
};
const storeDevice = (id: string | null) => {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // private mode: the device stays registered until sign-out
  }
};

/** Whether this device gets pushes now. */
export async function pushState(): Promise<PushState> {
  const native = nativePush();
  if (native) {
    const { receive } = await native.checkPermissions();
    if (receive === "denied") return "denied";
    return receive === "granted" && storedDevice() ? "on" : "off";
  }
  if (typeof Notification === "undefined") return "off";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && storedDevice() ? "on" : "off";
}

async function registerDevice(body: Record<string, unknown>) {
  const { device } = await api<{ device: { id: string } }>("/v1/me/devices", { method: "POST", body });
  storeDevice(device.id);
}

const urlBase64ToUint8Array = (base64: string) => {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/** Android channels: urgent requests ring and pop up; the rest arrive quietly. */
async function createChannels(native: NativePush, labels: { urgent: string; requests: string }) {
  if (nativePlatform() !== "android") return;
  await native.createChannel({
    id: "urgent",
    name: labels.urgent,
    importance: 5,
    sound: "default",
    vibration: true,
    visibility: 1,
  });
  await native.createChannel({ id: "requests", name: labels.requests, importance: 3, visibility: 0 });
}

/** The native token arrives in an event after register(). */
function nativeToken(native: NativePush): Promise<string> {
  return new Promise((resolve, reject) => {
    const listeners: Promise<Listener>[] = [];
    const done = () => listeners.forEach((l) => void l.then((x) => x.remove()));
    const timer = setTimeout(() => {
      done();
      reject(new Error("No push token from the system"));
    }, 20_000);
    listeners.push(
      native.addListener("registration", ({ value }) => {
        clearTimeout(timer);
        done();
        resolve(value);
      }),
      native.addListener("registrationError", ({ error }) => {
        clearTimeout(timer);
        done();
        reject(new Error(error));
      }),
    );
    void native.register();
  });
}

/** Asks for permission (when needed) and registers this device. */
export async function enablePush(labels: { urgent: string; requests: string }): Promise<PushState> {
  const native = nativePush();
  if (native) {
    let { receive } = await native.checkPermissions();
    if (receive !== "granted") ({ receive } = await native.requestPermissions());
    if (receive !== "granted") return receive === "denied" ? "denied" : "off";
    await createChannels(native, labels);
    const token = await nativeToken(native);
    await registerDevice({ platform: nativePlatform(), token });
    return "on";
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const { webPushPublicKey } = await api<{ webPushPublicKey: string | null }>("/v1/push/config");
  if (!webPushPublicKey) return "off";
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(webPushPublicKey),
    }));
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await registerDevice({ platform: "web", token: json.endpoint, keys: json.keys });
  return "on";
}

/** Stops pushes to this device. */
export async function disablePush(): Promise<void> {
  const id = storedDevice();
  if (id) await api(`/v1/me/devices/${id}`, { method: "DELETE" }).catch(() => undefined);
  storeDevice(null);
  const native = nativePush();
  if (native) {
    await native.unregister().catch(() => undefined);
    return;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
}

/** Before signing out: forget the device locally (the server drops it with the session). */
export const forgetPushDevice = () => storeDevice(null);

/**
 * On every page load in the app: renews the token when notifications are on (tokens can change
 * after an OS update or reinstall) and opens the request when a notification is tapped.
 */
export async function startNativePush(open: (path: string) => void): Promise<void> {
  const native = nativePush();
  if (!native) return;
  await native.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const url = notification.data?.url;
    // Only paths inside the portal.
    if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) open(url);
  });
  const { receive } = await native.checkPermissions();
  if (receive !== "granted" || !storedDevice()) return;
  try {
    const token = await nativeToken(native);
    await registerDevice({ platform: nativePlatform(), token });
  } catch {
    // signed out (401) or no network: tried again on the next start
  }
}
