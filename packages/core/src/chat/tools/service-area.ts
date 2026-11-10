import { businessProfiles, withTenant } from "@traiblazer/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeForMatch } from "../triage.js";
import { defineTool } from "./contract.js";

export interface ServiceArea {
  /** Town names as the owner wrote them. */
  towns: string[];
  /** Postal code beginnings, e.g. "N1H" or "N1". */
  postalPrefixes: string[];
}

export type AreaCheck =
  | { result: "in"; matched: string }
  | { result: "not_listed" }
  /** No town or postal code from the list could be read in the location, and none was recognisable. */
  | { result: "unclear" };

/** Canadian postal codes, whole ("N1H 4E6") or the first three characters ("N1H"). */
const POSTAL = /\b([A-Za-z]\d[A-Za-z])[ -]?(\d[A-Za-z]\d)?\b/g;

const compact = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();

/**
 * Checks a location the visitor gave against the business's service area. A postal code decides
 * when the business lists postal codes; otherwise a listed town named in the location does.
 */
export function checkServiceArea(location: string, area: ServiceArea): AreaCheck {
  const prefixes = area.postalPrefixes.map(compact).filter(Boolean);
  const codes = [...location.matchAll(POSTAL)].map((m) => compact(`${m[1]}${m[2] ?? ""}`));
  if (codes.length && prefixes.length) {
    for (const code of codes) {
      const prefix = prefixes.find((p) => code.startsWith(p));
      if (prefix) return { result: "in", matched: prefix };
    }
  }
  const place = ` ${normalizeForMatch(location)} `;
  for (const town of area.towns) {
    const name = normalizeForMatch(town);
    if (name && place.includes(` ${name} `)) return { result: "in", matched: town.trim() };
  }
  // A recognisable place that matched nothing listed is outside the list.
  if ((codes.length && prefixes.length) || (area.towns.length && /\p{L}{3,}/u.test(location))) {
    return { result: "not_listed" };
  }
  return { result: "unclear" };
}

const listed = (area: ServiceArea) =>
  [
    area.towns.length ? `towns: ${area.towns.join(", ")}` : null,
    area.postalPrefixes.length ? `postal codes starting with: ${area.postalPrefixes.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");

/**
 * The service-area check (PLAN §4.2): only for businesses that listed towns or postal codes. Its
 * answer is the business's own list, read on the server, never the model's idea of geography.
 */
export const checkServiceAreaTool = defineTool({
  name: "check_service_area",
  description:
    "Check whether the business serves a location: a town, an address or a postal code the visitor gave. Use it whenever a visitor asks if you come to their area, or gives an address for a visit or a quote. It answers from the business's own list of towns and postal codes.",
  input: z.object({
    location: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .describe("The town, address or postal code exactly as the visitor gave it."),
  }),

  async run(input, ctx) {
    const [profile] = await withTenant(ctx.db, ctx.tenantId, (tx) =>
      tx
        .select({ towns: businessProfiles.serviceTowns, prefixes: businessProfiles.servicePostalPrefixes })
        .from(businessProfiles)
        .where(eq(businessProfiles.botId, ctx.botId))
        .limit(1),
    );
    const area = { towns: profile?.towns ?? [], postalPrefixes: profile?.prefixes ?? [] };
    if (!area.towns.length && !area.postalPrefixes.length) {
      return {
        isError: true,
        content:
          "The business hasn't listed its service area. Use the service area text in <business_profile>, if any.",
      };
    }
    const check = checkServiceArea(input.location, area);
    const quoted = JSON.stringify(input.location);
    if (check.result === "in") {
      return { content: `${quoted} is in the service area (listed: ${check.matched}).` };
    }
    if (check.result === "not_listed") {
      return {
        content: `${quoted} isn't in the business's service area list (${listed(area)}). Say it isn't in the listed area; don't say the business never goes there. Offer to pass the question on, or give the phone number.`,
      };
    }
    return {
      content: `Couldn't tell from ${quoted}. Ask for the town or the postal code. The listed area is ${listed(area)}.`,
    };
  },
});
