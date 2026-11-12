/**
 * Runs the evals against the chat engine with the AI providers configured in the environment
 * (.env), on the database in DATABASE_URL. Test businesses are created for the run and removed
 * afterwards.
 *
 *   pnpm evals                              every case once
 *   pnpm evals --business trades --lang fr  one pack, one language
 *   pnpm evals --category danger            one category (see types.ts)
 *   pnpm evals --case burst --repeat 3      cases whose id contains "burst", three runs each
 *   pnpm evals --list                       show the cases without running them
 *
 * Exits with 1 when the quality bar isn't met or a safety case fails.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createDb } from "@traiblazer/db";
import { createEmbeddingsFromEnv, createGatewayFromEnv, QueryEmbedder } from "@traiblazer/llm";
import { BUSINESSES } from "./businesses.js";
import { ALL_CASES } from "./cases/index.js";
import { DEFAULT_MIN_QUALITY, formatReport, summarize, toJson } from "./report.js";
import { runEvals } from "./run.js";
import { CATEGORIES, type Category, SAFETY_CATEGORIES } from "./types.js";

const { values } = parseArgs({
  options: {
    business: { type: "string" },
    lang: { type: "string" },
    category: { type: "string" },
    case: { type: "string" },
    repeat: { type: "string", default: "1" },
    "min-quality": { type: "string", default: String(DEFAULT_MIN_QUALITY) },
    out: { type: "string" },
    list: { type: "boolean", default: false },
  },
});

if (values.category && !CATEGORIES.includes(values.category as Category)) {
  console.error(`Unknown category "${values.category}". Categories: ${CATEGORIES.join(", ")}`);
  process.exit(2);
}

const cases = ALL_CASES.filter(
  (c) =>
    (!values.business || c.business === values.business) &&
    (!values.lang || c.language === values.lang) &&
    (!values.category || c.category === values.category) &&
    (!values.case || c.id.includes(values.case)),
);
if (!cases.length) {
  console.error("No cases match.");
  process.exit(2);
}

if (values.list) {
  for (const c of cases) {
    const safety = SAFETY_CATEGORIES.has(c.category) ? " [safety]" : "";
    console.log(`${c.id.padEnd(36)} ${c.category}${safety}  ${c.turns.at(-1)}`);
  }
  console.log(`\n${cases.length} cases`);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(2);
}
const repeat = Math.max(1, Number.parseInt(values.repeat, 10) || 1);
const minQuality = Number(values["min-quality"]);
const { gateway, offline } = createGatewayFromEnv(process.env);
const embeddings = createEmbeddingsFromEnv(process.env);
const routes = {
  chat: process.env.LLM_CHAT_ROUTES ?? null,
  aux: process.env.LLM_AUX_ROUTES ?? null,
  embeddings: embeddings?.model ?? null,
};

if (offline) {
  console.warn(
    "No AI provider is configured: replies come from the offline test model, so the results only show that the harness works.\n",
  );
}
console.log(`Running ${cases.length} case(s) × ${repeat} with chat model ${routes.chat ?? "(default)"}\n`);

const handle = createDb(url, { max: 4 });
const startedAt = new Date();
try {
  const queryEmbeddings = embeddings ? new QueryEmbedder(embeddings) : null;
  const results = await runEvals({ db: handle.db, gateway, embeddings, queryEmbeddings }, cases, BUSINESSES, {
    repeat,
    onResult: (r, done, total) => {
      const time = r.outcome.firstTextMs === null ? "" : ` ${r.outcome.firstTextMs} ms`;
      console.log(`${r.passed ? "✓" : "✗"} [${done}/${total}] ${r.case.id}${time}`);
    },
  });
  const summary = summarize(results, minQuality);
  console.log(formatReport(results, summary, minQuality));

  const out =
    values.out ??
    path.join("reports", `eval-${startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify(toJson(results, summary, { startedAt, routes, offline, repeat, minQuality }), null, 2)}\n`,
  );
  console.log(`\nReport: ${path.resolve(out)}`);
  process.exitCode = summary.ok ? 0 : 1;
} finally {
  await handle.close();
}
