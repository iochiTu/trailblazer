import { defineConfig, devices } from "@playwright/test";

// The servers' addresses come from the repository's .env, like the apps themselves.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // No .env: the defaults below (and any variables already set) apply.
}

/**
 * Accessibility checks run against servers that are already running (`pnpm dev`) with the demo data
 * (`pnpm db:seed`). They aren't part of `pnpm test`, which has no servers or browser.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // A phone-sized screen: most visitors open the business page from a link or QR code on a phone.
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
