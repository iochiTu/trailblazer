/**
 * Retrieval evals (docs/EMBEDDINGS.md §4.5): ranks with keyword search alone and with search by
 * meaning, the time a question's vector takes and the distances that set EMBEDDINGS_MAX_DISTANCE.
 * Uses the embedding provider in .env (no chat model); test businesses are removed afterwards.
 *
 *   pnpm evals:retrieval
 *   pnpm evals:retrieval --lang fr
 */
import { parseArgs } from "node:util";
import { createDb } from "@traiblazer/db";
import { createEmbeddingsFromEnv, QueryEmbedder } from "@traiblazer/llm";
import { BUSINESSES } from "./businesses.js";
import {
  addAnswers,
  formatRetrievalReport,
  RETRIEVAL_ANSWERS,
  RETRIEVAL_CASES,
  runRetrievalEvals,
} from "./retrieval.js";
import { removeBusinesses, setUpBusiness } from "./run.js";

const { values } = parseArgs({ options: { lang: { type: "string" }, business: { type: "string" } } });
const cases = RETRIEVAL_CASES.filter(
  (c) => (!values.lang || c.language === values.lang) && (!values.business || c.business === values.business),
);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(2);
}
const embeddings = createEmbeddingsFromEnv(process.env);
if (!embeddings) console.warn("Embeddings aren't configured: keyword search only.\n");
else console.log(`Embedding model: ${embeddings.model}\n`);
const waitMs = Number(process.env.EMBEDDINGS_QUERY_WAIT_MS) || 250;

const handle = createDb(url, { max: 2 });
const created = new Map<string, { tenantId: string; botId: string }>();
const deps = {
  db: handle.db,
  embeddings,
  queryEmbeddings: embeddings ? new QueryEmbedder(embeddings, { timeoutMs: 10_000 }) : null,
};
try {
  for (const key of new Set(cases.map((c) => c.business))) {
    const business = await setUpBusiness(deps, BUSINESSES[key]!);
    created.set(key, business);
    await addAnswers(deps, business, RETRIEVAL_ANSWERS[key] ?? []);
  }
  const results = await runRetrievalEvals(deps, created, cases);
  console.log(formatRetrievalReport(results, { waitMs }));
} finally {
  await removeBusinesses(
    handle.db,
    [...created.values()].map((b) => b.tenantId),
  );
  await handle.close();
}
