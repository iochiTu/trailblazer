import { McpServer } from "@modelcontextprotocol/server";
import {
  checkCity,
  cityFacts,
  companyFacts,
  getStartedFacts,
  industryFacts,
  type Lang,
  type PublicPlan,
  pricingFacts,
  type SiteConfig,
} from "@traiblazer/marketing";
import * as z from "zod/v4";

/**
 * The public MCP server: read-only tools that tell an AI assistant what Traiblazer is, who it is
 * for, what it costs and how to get started. It has no access to any business's data. Every answer
 * is built from `@traiblazer/marketing` (the same data as the public pages and llms.txt) and the
 * active plans.
 */

export interface PublicMcpDeps {
  site: SiteConfig;
  /** Active plans, as shown on the pricing page. */
  plans: () => Promise<PublicPlan[]>;
}

export const MCP_SERVER_INFO = { name: "traiblazer", title: "Traiblazer", version: "1.0.0" } as const;

const INSTRUCTIONS =
  "Public information about Traiblazer, an AI assistant and business page for small local businesses in Canada. " +
  "All tools are read-only and need no sign-in. Use get_pricing for current prices rather than quoting from memory.";

/** Nothing here changes anything, and every tool answers from a fixed set of facts. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const language = z.enum(["en", "fr"]).optional().describe("Language of the answer: en (default) or fr");
const languageOnly = z.object({ language });

const contactSchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

const citySchema = z.object({
  id: z.string(),
  name: z.string(),
  province: z.string(),
  region: z.string(),
  nearbyCommunities: z.array(z.string()),
  page: z.string(),
  industryPages: z.array(z.object({ industry: z.string(), url: z.string() })),
});

/** Tool results carry the data twice: as JSON text for every client, and structured for those that read it. */
function result<T extends Record<string, unknown>>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

const langOf = (value: Lang | undefined): Lang => value ?? "en";

/** Builds a server with every tool registered. The transport calls this once per request. */
export function buildPublicMcpServer({ site, plans }: PublicMcpDeps): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_company_info",
    {
      title: "About Traiblazer",
      description:
        "What Traiblazer is, who it is for, what it does, where it is available, its website and contact details.",
      inputSchema: languageOnly,
      outputSchema: z.object({
        name: z.string(),
        legalName: z.string().optional(),
        tagline: z.string(),
        summary: z.string(),
        whoItIsFor: z.string(),
        serviceArea: z.string(),
        languages: z.array(z.string()),
        features: z.array(z.object({ title: z.string(), description: z.string() })),
        website: z.string(),
        links: z.object({ pricing: z.string(), cities: z.string(), signup: z.string(), llmsTxt: z.string() }),
        contact: contactSchema,
      }),
      annotations: READ_ONLY,
    },
    async ({ language }) => result(companyFacts(site, langOf(language))),
  );

  server.registerTool(
    "list_industries",
    {
      title: "Industries served",
      description:
        "The kinds of business Traiblazer is set up for, with what its assistant does and will not do for each.",
      inputSchema: languageOnly,
      outputSchema: z.object({
        industries: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            businessTypes: z.array(z.string()),
            whatItDoes: z.array(z.string()),
            whatItWillNotDo: z.string(),
            questionsCustomersAsk: z.array(z.string()),
          }),
        ),
      }),
      annotations: READ_ONLY,
    },
    async ({ language }) => result(industryFacts(langOf(language))),
  );

  server.registerTool(
    "get_pricing",
    {
      title: "Plans and prices",
      description:
        "Current plans with monthly prices in Canadian dollars and what each includes. A null price means the price is on request.",
      inputSchema: languageOnly,
      outputSchema: z.object({
        currency: z.string(),
        billingPeriod: z.string(),
        note: z.string(),
        plans: z.array(
          z.object({
            id: z.string(),
            name: z.object({ en: z.string(), fr: z.string() }),
            priceMonthly: z.number().nullable(),
            currency: z.string(),
            priceNote: z.string(),
            monthlyQuestions: z.number(),
            questionsPerMinute: z.number(),
            concurrentAnswers: z.number(),
            photosPerAssistant: z.number(),
          }),
        ),
        pricingPage: z.string(),
      }),
      annotations: READ_ONLY,
    },
    async ({ language }) => result(pricingFacts(site, await plans(), langOf(language))),
  );

  server.registerTool(
    "list_cities",
    {
      title: "Cities with local pages",
      description:
        "The cities that have their own Traiblazer pages, with links to the page of each industry there.",
      inputSchema: languageOnly,
      outputSchema: z.object({ serviceArea: z.string(), cities: z.array(citySchema) }),
      annotations: READ_ONLY,
    },
    async ({ language }) => result(cityFacts(site, langOf(language))),
  );

  server.registerTool(
    "check_city_served",
    {
      title: "Is a city served?",
      description:
        "Says whether a business in a given city can use Traiblazer and whether that city has local pages. Traiblazer is online software, so it is not limited to the listed cities.",
      inputSchema: z.object({
        city: z.string().trim().min(1).max(80).describe('City or town name, e.g. "Thunder Bay"'),
        language,
      }),
      outputSchema: z.object({
        query: z.string(),
        availableOnline: z.boolean(),
        hasLocalPage: z.boolean(),
        matched: z.enum(["city", "nearby_community"]).optional(),
        note: z.string(),
        serviceArea: z.string(),
        city: citySchema.optional(),
        signup: z.string(),
      }),
      annotations: READ_ONLY,
    },
    async ({ city, language }) => result(checkCity(site, city, langOf(language))),
  );

  server.registerTool(
    "get_started",
    {
      title: "How to get started or get in touch",
      description:
        "How a business tries Traiblazer (free trial, no sales call) and how to contact the company.",
      inputSchema: languageOnly,
      outputSchema: z.object({
        howToStart: z.string(),
        signup: z.string(),
        pricing: z.string(),
        steps: z.array(z.string()),
        contact: contactSchema,
      }),
      annotations: READ_ONLY,
    },
    async ({ language }) => result(getStartedFacts(site, langOf(language))),
  );

  return server;
}
