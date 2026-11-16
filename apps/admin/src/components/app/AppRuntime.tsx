"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { startNativePush } from "@/lib/push";

/**
 * Owner app plumbing on every page (PLAN §20.3): the service worker (offline page, Web Push) and,
 * inside the iOS / Android app, opening the request a tapped notification is about.
 */
export function AppRuntime() {
  const router = useRouter();
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    void startNativePush((path) => router.push(path));
  }, [router]);
  return null;
}
