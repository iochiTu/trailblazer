# Traiblazer owner app (iOS and Android)

The owner app (PLAN §20) is a [Capacitor](https://capacitorjs.com) shell around the hosted admin
portal: the native app opens `MOBILE_PORTAL_URL/inbox`, and the portal's phone-first screens
(Inbox, request with notes, Notifications) do the rest. Web changes reach the app as soon as the
portal is deployed. A store release is only needed for native changes: plugins, permissions,
icons, the Capacitor version.

```
apps/mobile/
  capacitor.config.ts   portal URL, app id, plugins (push, splash screen)
  www/                  offline page shown when the portal can't load; portal.js is generated
  ios/                  Xcode project (Swift Package Manager, no CocoaPods)
  android/              Android Studio project
  scripts/prepare-www.mjs
```

## How push works

1. The portal (`apps/admin/src/lib/push.ts`) asks for permission through `@capacitor/push-notifications`.
   iOS gives an APNs device token, Android an FCM token, and the portal posts it to `POST /v1/me/devices`.
   A browser or installed PWA subscribes with Web Push instead.
2. A device belongs to the sign-in that registered it. Signing out deletes it, so a phone that's
   handed on stops getting the business's notifications.
3. New and urgent requests (chat engine) and notes on requests (API) queue a `push.notify` job.
   The worker (`packages/core/src/push/notify.ts`) applies each person's choices and quiet hours,
   then sends through `packages/push`: APNs directly over HTTP/2, FCM HTTP v1, Web Push with VAPID.
4. Tapping a notification opens `/t/<business>/inbox/<assistant>/<request>`. Lock-screen text never
   includes the customer's name, phone number or message.

## One-time setup

| What | Where | Then |
|---|---|---|
| Apple Developer account ($99/year) | developer.apple.com | Create the App ID `com.traiblazer.app` (or your `MOBILE_APP_ID`) with **Push Notifications** and **Time Sensitive Notifications** |
| APNs key (.p8) | Apple Developer → Keys → new key with Apple Push Notifications service | Worker env: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT` (`sandbox` for Xcode builds, `production` for TestFlight and the App Store) |
| Google Play Console ($25 once) | play.google.com/console | Create the app with the same id |
| Firebase project | console.firebase.google.com → add an Android app with the app id | Put `google-services.json` in `android/app/` (ignored by git). Worker env: `FCM_SERVICE_ACCOUNT_FILE` (Project settings → Service accounts → Generate key) |
| Web Push keys | `npx web-push generate-vapid-keys` | API env: `VAPID_PUBLIC_KEY`. Worker env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |

The portal must be served over **https** in production. Plain http only works for a portal on
your own computer, in a simulator or emulator.

## Build and run

You need Xcode (iOS) and Android Studio (Android).

```bash
pnpm install
MOBILE_PORTAL_URL=https://app.example.com pnpm --filter @traiblazer/mobile ios      # sync + open Xcode
MOBILE_PORTAL_URL=https://app.example.com pnpm --filter @traiblazer/mobile android  # sync + open Android Studio
```

Without `MOBILE_PORTAL_URL` the app loads `http://localhost:3000`, the local dev portal. That works
in the iOS Simulator; on the Android emulator use `MOBILE_PORTAL_URL=http://10.0.2.2:3000`.
Push notifications need a real device: the iOS Simulator can't receive APNs pushes from a server.

In Xcode, choose your team under **Signing & Capabilities**. The project already includes the push
entitlement (`ios/App/App/App.entitlements`) and the AppDelegate code that passes the APNs token
to the plugin.

## Still to do (PLAN §20.7)

- Android app icons (iOS has the brand icon; Android still has Capacitor's default)
- Voice and photo updates (camera and microphone permissions, step 4)
- Store listings in English and French, privacy labels, review notes (step 5)
- Phone-number sign-in with a code by SMS (step 6, with the SMS phase)
