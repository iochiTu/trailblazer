import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * Accessibility (PLAN §15): every page visitors and owners use, checked with axe against WCAG 2.2
 * level AA, on a desktop and a phone-sized screen, plus a few checks axe can't make (keyboard,
 * no sideways scrolling). Needs the servers running and the demo data seeded (see the README).
 */

const API = (process.env.PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
const ADMIN = (process.env.ADMIN_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
// The seeded accounts (apps/api/src/seed.ts).
const OWNER = { email: "demo@traiblazer.local", password: "demo-password-123" };
const STAFF = { email: "staff@traiblazer.local", password: "staff-password-123" };

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Runs axe on the page and reports a readable list of what's wrong. Problems are collected (soft
 * assertions), so one run shows every page's problems.
 */
async function audit(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes
        .slice(0, 5)
        .map((n) => `${n.target.join(" ")}${n.any[0]?.message ? ` — ${n.any[0].message}` : ""}`)
        .join("\n    ")}`,
  );
  expect.soft(found, `${name}: accessibility problems`).toEqual([]);
}

/** The page fits the screen: nothing to scroll sideways (WCAG 1.4.10 Reflow). */
async function fitsScreen(page: Page, name: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect.soft(overflow, `${name}: scrolls sideways`).toBeLessThanOrEqual(0);
}

/** Session cookies by account: signing in once keeps clear of the sign-in rate limit. */
const sessions = new Map<string, { name: string; value: string; domain: string; path: string }[]>();

async function signIn(request: APIRequestContext, account: { email: string; password: string }) {
  if (!sessions.has(account.email)) {
    const res = await request.post(`${ADMIN}/api/v1/auth/login`, { data: account });
    expect(res.ok(), `sign-in as ${account.email} (run pnpm db:seed?)`).toBe(true);
    sessions.set(account.email, (await request.storageState()).cookies);
  }
  return sessions.get(account.email)!;
}

/** The seeded business, its assistant and its public key. */
async function demoBusiness(request: APIRequestContext) {
  const { tenants } = await (await request.get(`${ADMIN}/api/v1/tenants`)).json();
  const tenantId = tenants[0].id as string;
  const { bots } = await (await request.get(`${ADMIN}/api/v1/tenants/${tenantId}/bots`)).json();
  const botId = bots.at(-1).id as string;
  const detail = await (await request.get(`${ADMIN}/api/v1/tenants/${tenantId}/bots/${botId}`)).json();
  return { tenantId, botId, publicKey: detail.keys[0].publicKey as string };
}

/** Waits until a client-rendered admin page has loaded its data. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".spinner, [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
}

// Reduced motion: contrast is measured on the finished page, not halfway through a fade-in.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test.describe("visitors", () => {
  let publicKey: string;
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await signIn(request, OWNER);
    ({ publicKey } = await demoBusiness(request));
    await request.dispose();
  });

  test("business page", async ({ page }) => {
    await page.goto(`${API}/c/${publicKey}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("textarea")).toBeVisible();
    await audit(page, "business page");
    await fitsScreen(page, "business page");
  });

  test("business page: the chat works from the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "no keyboard on a phone");
    await page.goto(`${API}/c/${publicKey}`);
    const input = page.getByRole("textbox").last();
    await expect(input).toBeVisible();
    // Tab through the page until the message box has focus.
    for (let i = 0; i < 60; i++) {
      if (await input.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(input).toBeFocused();
    // Where the keyboard is must be visible: the composer around the message box changes its border.
    const composer = page.locator(".tb-composer");
    const focused = await composer.evaluate((el) => getComputedStyle(el).borderColor);
    await input.blur();
    const unfocused = await composer.evaluate((el) => getComputedStyle(el).borderColor);
    expect(focused, "the message box shows that it has focus").not.toBe(unfocused);
  });

  test("chat inside a website (iframe and widget)", async ({ page }) => {
    await page.goto(`${API}/c/${publicKey}?embed=inline`);
    await expect(page.locator("textarea")).toBeVisible();
    await audit(page, "embedded chat");
    await fitsScreen(page, "embedded chat");
  });

  test("unavailable chat", async ({ page }) => {
    await page.goto(`${API}/c/pk_test_doesnotexist0000`);
    await audit(page, "unavailable chat page");
  });
});

test.describe("business owners", () => {
  test("sign-in and sign-up", async ({ page }) => {
    for (const path of ["/login", "/signup"]) {
      await page.goto(`${ADMIN}${path}`);
      await settle(page);
      await audit(page, path);
      await fitsScreen(page, path);
    }
  });

  test("dashboard, usage and every tab of the assistant", async ({ page }) => {
    await page.context().addCookies(await signIn(page.request, OWNER));
    const { tenantId, botId } = await demoBusiness(page.request);
    for (const path of ["/dashboard", `/t/${tenantId}/usage`]) {
      await page.goto(`${ADMIN}${path}`);
      await settle(page);
      await audit(page, path);
      await fitsScreen(page, path);
    }
    for (const tab of [
      "knowledge",
      "page",
      "workflows",
      "addons",
      "general",
      "appearance",
      "test",
      "share",
      "requests",
      "conversations",
    ]) {
      await page.goto(`${ADMIN}/t/${tenantId}/bots/${botId}?tab=${tab}`);
      await settle(page);
      await audit(page, `assistant tab "${tab}"`);
      await fitsScreen(page, `assistant tab "${tab}"`);
    }
  });
});

test.describe("staff", () => {
  test("operator console", async ({ page }) => {
    await page.context().addCookies(await signIn(page.request, STAFF));
    await page.goto(`${ADMIN}/operator`);
    await settle(page);
    await audit(page, "operator console");
  });
});
