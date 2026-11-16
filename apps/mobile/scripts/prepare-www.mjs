/**
 * Writes www/portal.js with the portal's address, for the offline page's "Try again" button, and
 * copies the app icon. Run before `cap sync` (the package scripts do).
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const www = join(here, "..", "www");
const portal = new URL(process.env.MOBILE_PORTAL_URL ?? "http://localhost:3000").origin;
writeFileSync(
  join(www, "portal.js"),
  `window.TB_PORTAL_URL = ${JSON.stringify(`${portal}/inbox?source=app`)};\n`,
);
copyFileSync(join(here, "..", "..", "admin", "public", "icons", "icon-192.png"), join(www, "icon.png"));
console.log("portal:", portal);
