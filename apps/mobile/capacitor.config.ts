import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Traiblazer owner app for iOS and Android (PLAN §20): a native shell around the hosted admin
 * portal. The portal is loaded from MOBILE_PORTAL_URL, so web changes reach the app without a
 * store release; only native changes (plugins, icons, permissions) need one. Without a connection
 * the bundled www/offline.html shows instead.
 *
 * Set before `pnpm --filter @traiblazer/mobile sync`:
 *   MOBILE_PORTAL_URL  https://app.example.com (default: the local dev portal, for a simulator)
 *   MOBILE_APP_ID      bundle id / application id (default com.traiblazer.app)
 */
const portal = new URL(process.env.MOBILE_PORTAL_URL ?? "http://localhost:3000");
const local = portal.protocol === "http:";

const config: CapacitorConfig = {
  appId: process.env.MOBILE_APP_ID ?? "com.traiblazer.app",
  appName: "Traiblazer",
  webDir: "www",
  server: {
    url: portal.origin + "/inbox?source=app",
    // Shown when the portal can't be reached (no signal).
    errorPath: "offline.html",
    // Only the portal opens inside the app; other links (Stripe, Google, calendars) open in the browser.
    allowNavigation: [portal.hostname],
    // Plain http only for a portal on this computer, in development.
    cleartext: local,
  },
  ios: {
    contentInset: "never",
    // The portal draws under the status bar and uses the safe-area insets itself.
    scrollEnabled: true,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      // While the app is open, still show the banner and play the sound.
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#3b5bdb",
      showSpinner: false,
    },
  },
};

export default config;
