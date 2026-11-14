/**
 * Insights evals: asks the "aux" model in .env to tag labelled conversations (no database).
 *
 *   pnpm --filter @traiblazer/evals eval:insights
 *   pnpm --filter @traiblazer/evals eval:insights --lang fr
 */
import { parseArgs } from "node:util";
import { createGatewayFromEnv } from "@traiblazer/llm";
import { formatInsightReport, INSIGHT_CASES, runInsightEvals } from "./insights.js";

const { values } = parseArgs({ options: { lang: { type: "string" } } });
const cases = INSIGHT_CASES.filter((c) => !values.lang || c.language === values.lang);
const { gateway, offline } = createGatewayFromEnv(process.env);
if (offline) {
  console.error("No AI model is configured in .env: Insights has nothing to evaluate.");
  process.exit(2);
}
const results = await runInsightEvals(gateway, cases);
console.log(formatInsightReport(results));
