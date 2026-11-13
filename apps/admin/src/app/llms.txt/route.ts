import { buildLlmsTxt } from "@traiblazer/marketing";
import { fetchPlans, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

/** /llms.txt: a short description of the company for AI assistants (https://llmstxt.org). */
export async function GET() {
  return new Response(buildLlmsTxt(siteConfig(), await fetchPlans()), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
