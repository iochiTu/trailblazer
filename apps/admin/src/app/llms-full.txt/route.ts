import { buildLlmsFullTxt } from "@traiblazer/marketing";
import { fetchPlans, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

/** /llms-full.txt: llms.txt plus every industry, city and local page. */
export async function GET() {
  return new Response(buildLlmsFullTxt(siteConfig(), await fetchPlans()), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
