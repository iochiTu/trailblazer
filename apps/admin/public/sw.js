/*
 * Traiblazer owner app service worker (PLAN §20.3).
 * - Shows an offline page when a page can't load (live data is never served from a cache).
 * - Shows push notifications (Web Push) and opens the request when one is tapped.
 * Bump VERSION when offline.html or the icons change.
 */
const VERSION = "tb-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Pages only: the network first, the offline page when there's no connection.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((page) => page ?? Response.error())),
  );
});

self.addEventListener("push", (event) => {
  let message;
  try {
    message = event.data?.json() ?? null;
  } catch {
    message = null;
  }
  if (!message?.title) return;
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      renotify: Boolean(message.tag),
      requireInteraction: Boolean(message.urgent),
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-32.png",
      data: { url: message.url || "/inbox" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/inbox", self.location.origin);
  // Only our own pages.
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === url.origin);
      if (open) return open.focus().then((w) => w.navigate(url.href));
      return self.clients.openWindow(url.href);
    }),
  );
});
