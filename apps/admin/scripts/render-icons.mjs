/**
 * Renders the app icons (PWA manifest, iOS home screen, favicon) from public/icons/icon.svg.
 * Run after changing the icon:  pnpm --filter @traiblazer/e2e exec node ../admin/scripts/render-icons.mjs
 * (uses the e2e package's Playwright Chromium).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "icons");
const { chromium } = createRequire(join(process.cwd(), "package.json"))("@playwright/test");
const svg = readFileSync(join(out, "icon.svg"), "utf8");
// Full-bleed square: the platform rounds the corners itself (iOS, Android maskable icons).
const square = svg.replace(' rx="112"', "");
// Maskable: the mark inside the 80 % safe zone.
const maskable = square.replace("translate(128 128) scale(10.667)", "translate(166 166) scale(7.5)");

const icons = [
  ["icon-192.png", 192, svg],
  ["icon-512.png", 512, svg],
  ["maskable-512.png", 512, maskable],
  ["apple-touch-icon.png", 180, square],
  ["favicon-32.png", 32, svg],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, source] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  );
  await page.screenshot({ path: join(out, name), omitBackground: true });
  console.log("wrote", name);
}
await browser.close();
