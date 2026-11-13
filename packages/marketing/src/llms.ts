import { cities } from "./cities.js";
import { industries } from "./industries.js";
import { absolute, buildLandingPage, GENERAL_FAQS, paths } from "./pages.js";
import { type PublicPlan, planIncludes, planName, priceLabel } from "./plans.js";
import {
  FEATURES,
  GET_STARTED,
  PLANS_INCLUDE,
  PRICE_NOTE,
  SERVICE_AREA,
  SUMMARY,
  WHO_FOR,
} from "./product.js";
import { formatAddress, type SiteConfig } from "./site.js";

/**
 * /llms.txt and /llms-full.txt (https://llmstxt.org): a plain-text description of the company for
 * AI assistants. Built from the same data as the pages. `plans` is null when the plan list couldn't
 * be loaded; the file then points to the pricing page instead of quoting numbers.
 */

function pricingLines(plans: PublicPlan[] | null): string[] {
  if (!plans?.length) return ["Current plans and prices are on the pricing page."];
  return [
    ...plans.map(
      (plan) =>
        `- ${planName(plan, "en")}: ${priceLabel(plan, "en")}. ${planIncludes(plan, "en").join("; ")}.`,
    ),
    "",
    `${PRICE_NOTE.en} ${PLANS_INCLUDE.en}`,
  ];
}

function contactLines(site: SiteConfig): string[] {
  return [
    `- [Sign up](${absolute(site, paths.signup())}): ${GET_STARTED.en}`,
    ...(site.email ? [`- Email: ${site.email}`] : []),
    ...(site.phone ? [`- Phone: ${site.phone}`] : []),
    ...(site.address ? [`- Address: ${formatAddress(site.address)}`] : []),
    ...(site.legalName ? [`- Legal name: ${site.legalName}`] : []),
  ];
}

function head(site: SiteConfig, plans: PublicPlan[] | null): string[] {
  return [
    `# ${site.brand}`,
    "",
    `> ${SUMMARY.en}`,
    "",
    `Who it is for: ${WHO_FOR.en}`,
    "",
    `Service area: ${SERVICE_AREA.en}`,
    "",
    `Cities with local pages: ${cities.map((c) => c.name.en).join(", ")} (Ontario, Canada).`,
    "",
    `Industries: ${industries.map((i) => i.name.en).join("; ")}.`,
    "",
    "## Pricing",
    "",
    ...pricingLines(plans),
    "",
    "## Get started or get in touch",
    "",
    ...contactLines(site),
    "",
    "## Key pages",
    "",
    `- [Home](${absolute(site, paths.home())}): what the product does, how it works, plans and common questions`,
    `- [Pricing](${absolute(site, paths.pricing("en"))}): plans and prices in Canadian dollars`,
    `- [Tarifs](${absolute(site, paths.pricing("fr"))}): the pricing page in French`,
    `- [Cities](${absolute(site, paths.cities("en"))}): every city with a local page`,
    "",
    "## For AI assistants",
    "",
    `- [MCP server](${site.mcpUrl}): a public, read-only Model Context Protocol server (streamable HTTP, no sign-in) with tools for company information, industries, pricing, service area and how to get started`,
    `- [Full details](${absolute(site, paths.llmsFull())}): this file plus every industry and local page`,
  ];
}

export function buildLlmsTxt(site: SiteConfig, plans: PublicPlan[] | null): string {
  return [
    ...head(site, plans),
    "",
    "## Cities",
    "",
    ...cities.map(
      (city) => `- [${city.name.en}](${absolute(site, paths.city("en", city.slug))}): ${city.region.en}`,
    ),
    "",
  ].join("\n");
}

export function buildLlmsFullTxt(site: SiteConfig, plans: PublicPlan[] | null): string {
  const lines = [...head(site, plans), "", "## What it does", ""];
  for (const feature of FEATURES) lines.push(`- ${feature.title.en}: ${feature.body.en}`);

  lines.push("", "## Industries", "");
  for (const industry of industries) {
    lines.push(
      `### ${industry.name.en}`,
      "",
      `For: ${industry.kinds.en.join(", ")}.`,
      "",
      industry.problem.en,
      "",
      ...industry.does.en.map((line) => `- ${line}`),
      "",
      `Limits: ${industry.limits.en}`,
      "",
      `Questions customers ask: ${industry.sampleQuestions.en.join(" ")}`,
      "",
    );
  }

  lines.push("## Cities", "");
  for (const city of cities) {
    lines.push(
      `### ${city.name.en}`,
      "",
      `${city.about.en} ${city.context.en}`,
      "",
      `Communities around it: ${city.nearby.join(", ")}.`,
      "",
      ...industries.map((industry) => {
        const en = buildLandingPage("en", city, industry);
        const fr = buildLandingPage("fr", city, industry);
        return `- [${en.heading}](${absolute(site, en.path)}) ([français](${absolute(site, fr.path)}))`;
      }),
      "",
    );
  }

  lines.push("## Common questions", "");
  for (const faq of GENERAL_FAQS.en) lines.push(`### ${faq.question}`, "", faq.answer, "");
  return lines.join("\n");
}
