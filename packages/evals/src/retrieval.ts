import { embedChunks, retrievePassages, tsvectorSql } from "@traiblazer/core";
import { qaPairs, withTenant } from "@traiblazer/db";
import { sql } from "drizzle-orm";
import type { EvalDeps } from "./run.js";

/**
 * Retrieval evals for search by meaning (docs/EMBEDDINGS.md §4.5): does the visitor's question,
 * as typed (no query rewriting), bring up the right part of the business's information? Questions
 * use other words than the text, or the other language, so keyword search alone often misses them.
 */
export interface RetrievalCase {
  id: string;
  business: string;
  language: "en" | "fr";
  question: string;
  /**
   * Title of the knowledge source that answers it (businesses.ts), or null for a question nothing
   * answers: its distances show where EMBEDDINGS_MAX_DISTANCE should cut.
   */
  expect: string | null;
  /** The answer is one of the owner's Q&A pairs (RETRIEVAL_ANSWERS): `expect` is its question. */
  answer?: true;
}

/**
 * Q&A pairs the owner wrote, on things the businesses' text doesn't mention. Added for these evals
 * only (the chat evals' businesses stay as they are).
 */
export const RETRIEVAL_ANSWERS: Record<string, { question: string; answer: string }[]> = {
  trades: [
    {
      question: "Do your plumbers wear shoe covers in the house?",
      answer: "Yes. Our technicians wear boot covers and clean up the work area before they leave.",
    },
  ],
  auto: [
    {
      question: "Can I bring my dog to the waiting area?",
      answer: "Yes, friendly dogs on a leash are welcome in the waiting room.",
    },
  ],
};

/** Saves the owner's Q&A pairs for a test business and embeds them, like the worker's job. */
export async function addAnswers(
  deps: Pick<EvalDeps, "db" | "embeddings">,
  business: { tenantId: string; botId: string },
  pairs: { question: string; answer: string }[],
): Promise<void> {
  if (!pairs.length) return;
  await withTenant(deps.db, business.tenantId, (tx) =>
    tx.insert(qaPairs).values(
      pairs.map((pair) => ({
        ...business,
        ...pair,
        tsv: tsvectorSql(`${pair.question}\n${pair.answer}`, "en") as unknown as string,
      })),
    ),
  );
  if (deps.embeddings) {
    await embedChunks({ db: deps.db, embeddings: deps.embeddings }, business.tenantId, business.botId);
  }
}

const trades = (
  id: string,
  language: "en" | "fr",
  question: string,
  expect: string | null,
): RetrievalCase => ({
  id: `trades.${language}.${id}`,
  business: "trades",
  language,
  question,
  expect,
});
const auto = (id: string, language: "en" | "fr", question: string, expect: string | null): RetrievalCase => ({
  id: `auto.${language}.${id}`,
  business: "auto",
  language,
  question,
  expect,
});

export const RETRIEVAL_CASES: RetrievalCase[] = [
  trades("retirees", "en", "Is there a discount for retirees?", "Estimates, payment and warranty"),
  trades("rent-tank", "en", "Can I lease a hot water tank from you?", "Water heaters"),
  trades("ac", "en", "Do you service AC units?", "About us"),
  trades("how-long", "en", "How long has your company been around?", "About us"),
  trades("overflow", "en", "My toilet is overflowing all over the floor, it's 2 am", "Emergency service"),
  trades(
    "rotten-egg",
    "en",
    "There's a rotten egg smell near my stove, what should I do?",
    "Emergency service",
  ),
  trades("web-booking", "en", "Can I schedule a furnace maintenance on your website?", "Booking"),
  trades("guarantee", "en", "Is your labour guaranteed?", "Estimates, payment and warranty"),
  trades("aines", "fr", "Y a-t-il un rabais pour les aînés ?", "Estimates, payment and warranty"),
  trades("location", "fr", "Est-ce que vous louez des chauffe-eau ?", "Water heaters"),
  trades("gaz", "fr", "Ça sent le gaz chez moi, je fais quoi ?", "Emergency service"),
  trades(
    "diagnostic",
    "fr",
    "Combien coûte la visite pour trouver le problème ?",
    "Estimates, payment and warranty",
  ),
  trades("climatisation", "fr", "Installez-vous des climatiseurs ?", "About us"),
  trades(
    "rendez-vous",
    "fr",
    "Puis-je prendre rendez-vous en ligne pour un entretien de fournaise ?",
    "Booking",
  ),
  auto("loaner", "en", "Is there a courtesy car I can borrow?", "Appointments and waiting"),
  auto("harley", "en", "Can you put new rubber on my Harley?", "About the shop"),
  auto("highway", "en", "My car died on the highway, can you come get it?", "Towing and breakdowns"),
  auto("instalments", "en", "Can I pay for the repair in monthly instalments?", "Payment and warranty"),
  auto("tesla", "en", "Do you work on Teslas?", "About the shop"),
  auto("phone-quote", "en", "Can you tell me over the phone what brakes will cost?", "Payment and warranty"),
  auto("ride", "en", "Can someone drive me home while you work on my car?", "Appointments and waiting"),
  auto("navette", "fr", "Avez-vous un service de navette ?", "Appointments and waiting"),
  auto("depanneuse", "fr", "Ma voiture est en panne, avez-vous une dépanneuse ?", "Towing and breakdowns"),
  auto("financement", "fr", "Offrez-vous du financement ?", "Payment and warranty"),
  auto("motos", "fr", "Réparez-vous les motos ?", "About the shop"),
  auto("hiver", "fr", "Quelles marques de pneus d'hiver vendez-vous ?", "About the shop"),
  auto("garantie", "fr", "Quelle est la garantie sur les réparations ?", "Payment and warranty"),
  // Answered by a Q&A pair the owner wrote, in other words or the other language.
  {
    ...trades(
      "answer-floors",
      "en",
      "Will your guys make a mess of my floors?",
      RETRIEVAL_ANSWERS.trades![0]!.question,
    ),
    answer: true,
  },
  {
    ...trades(
      "answer-proprete",
      "fr",
      "Vos techniciens salissent-ils la maison ?",
      RETRIEVAL_ANSWERS.trades![0]!.question,
    ),
    answer: true,
  },
  {
    ...auto("answer-pets", "en", "Are pets allowed while I wait?", RETRIEVAL_ANSWERS.auto![0]!.question),
    answer: true,
  },
  {
    ...auto("answer-chien", "fr", "Puis-je venir avec mon chien ?", RETRIEVAL_ANSWERS.auto![0]!.question),
    answer: true,
  },
  // Nothing in the information answers these.
  trades("none-solar", "en", "Do you install solar panels?", null),
  trades("none-chimney", "en", "Can you sweep my chimney?", null),
  trades("none-pizza", "en", "What toppings do you have on your pizza?", null),
  trades("none-toiture", "fr", "Réparez-vous les toitures ?", null),
  trades("none-deneigement", "fr", "Faites-vous le déneigement en hiver ?", null),
  auto("none-used-cars", "en", "Do you sell used cars?", null),
  auto("none-boat", "en", "Can you fix my boat motor?", null),
  auto("none-yoga", "en", "When is the next yoga class?", null),
  auto("none-esthetique", "fr", "Faites-vous l'esthétique automobile intérieure ?", null),
  auto("none-assurance", "fr", "Pouvez-vous m'aider avec ma réclamation d'assurance habitation ?", null),
];

export interface RetrievalResult {
  case: RetrievalCase;
  /** Results with vectors, for a question nothing answers (fewer is better). */
  hybridCount: number | null;
  /** Rank of the expected source (1 = first), null when not in the results. */
  keywordRank: number | null;
  hybridRank: number | null;
  /** Cosine distance of the expected source's closest chunk, and of the closest other chunk. */
  expectedDistance: number | null;
  otherDistance: number | null;
  embedMs: number | null;
  /** A question nothing answers brought up one of the owner's Q&A pairs. */
  wrongAnswer: boolean;
}

/** Plays the retrieval cases against businesses set up by `setUpBusiness`. */
export async function runRetrievalEvals(
  deps: Pick<EvalDeps, "db" | "queryEmbeddings">,
  businesses: Map<string, { tenantId: string; botId: string }>,
  cases: RetrievalCase[],
): Promise<RetrievalResult[]> {
  const results: RetrievalResult[] = [];
  for (const c of cases) {
    const business = businesses.get(c.business);
    if (!business) throw new Error(`Business "${c.business}" isn't set up`);
    const rankOf = (passages: { title: string | null }[]) => {
      if (!c.expect) return null;
      const index = passages.findIndex((p) => p.title === c.expect);
      return index < 0 ? null : index + 1;
    };
    let embedMs: number | null = null;
    let vector = null;
    if (deps.queryEmbeddings) {
      const started = performance.now();
      vector = await deps.queryEmbeddings.embed(c.question);
      embedMs = Math.round(performance.now() - started);
    }
    const found = await withTenant(deps.db, business.tenantId, async (tx) => {
      const keyword = await retrievePassages(tx, { botId: business.botId, queries: [c.question] });
      const hybrid = vector
        ? await retrievePassages(tx, { botId: business.botId, queries: [c.question], embedding: vector })
        : null;
      const distances = vector
        ? await tx.execute<{ title: string | null; distance: number }>(sql`
            select d.title, min(c.embedding <=> ${`[${vector.vector.join(",")}]`}::halfvec) as distance
              from chunks c join documents d on d.id = c.document_id
             where c.bot_id = ${business.botId} and c.embedding_model = ${vector.model}
             group by d.title`)
        : [];
      return { keyword, hybrid, distances };
    });
    const expected = found.distances.find((d) => d.title === c.expect);
    const others = found.distances.filter((d) => d.title !== c.expect).map((d) => Number(d.distance));
    results.push({
      case: c,
      keywordRank: rankOf(found.keyword),
      hybridRank: found.hybrid ? rankOf(found.hybrid) : null,
      hybridCount: found.hybrid ? found.hybrid.length : null,
      expectedDistance: expected ? Number(expected.distance) : null,
      otherDistance: others.length ? Math.min(...others) : null,
      embedMs,
      wrongAnswer: !c.expect && Boolean(found.hybrid?.some((p) => p.kind === "qa")),
    });
  }
  return results;
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");
const mrr = (ranks: (number | null)[]) =>
  ranks.length ? (ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length).toFixed(2) : "—";
const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

/** A readable summary: first-place hits and mean reciprocal rank, by language, with and without vectors. */
export function formatRetrievalReport(results: RetrievalResult[], options: { waitMs: number }): string {
  const lines: string[] = [];
  const hybrid = results.some((r) => r.embedMs !== null);
  const answered = results.filter((r) => r.case.expect && !r.case.answer);
  const answers = results.filter((r) => r.case.answer);
  const unanswerable = results.filter((r) => !r.case.expect);
  for (const r of results) {
    if (!r.case.expect) {
      const n = hybrid ? `  results with vectors ${r.hybridCount}` : "";
      const d = r.otherDistance !== null ? `, nearest chunk ${r.otherDistance.toFixed(3)}` : "";
      lines.push(`${r.case.id.padEnd(28)} (nothing answers it)${n}${d}`);
      continue;
    }
    const k = r.keywordRank ?? "–";
    const h = hybrid ? ` → ${r.hybridRank ?? "–"}` : "";
    const d =
      r.expectedDistance !== null
        ? `  distance ${r.expectedDistance.toFixed(3)} (nearest other ${r.otherDistance?.toFixed(3) ?? "–"})`
        : "";
    lines.push(`${r.case.id.padEnd(28)} rank ${k}${h}${d}`);
  }
  lines.push("");
  for (const language of ["en", "fr", null] as const) {
    const set = answered.filter((r) => !language || r.case.language === language);
    if (!set.length) continue;
    const label = language ?? "all";
    const keyword = set.map((r) => r.keywordRank);
    let line = `${label.padEnd(4)} keyword: first ${pct(keyword.filter((r) => r === 1).length, set.length)}, MRR ${mrr(keyword)}`;
    if (hybrid) {
      const both = set.map((r) => r.hybridRank);
      line += ` | with vectors: first ${pct(both.filter((r) => r === 1).length, set.length)}, MRR ${mrr(both)}`;
    }
    lines.push(line);
  }
  if (answers.length) {
    const found = (ranks: (number | null)[]) =>
      `${ranks.filter((r) => r !== null).length} of ${ranks.length}`;
    let line = `owner's answers found: keyword ${found(answers.map((r) => r.keywordRank))}`;
    if (hybrid) line += ` | with vectors ${found(answers.map((r) => r.hybridRank))}`;
    lines.push(line);
  }
  if (hybrid) {
    const pulled = unanswerable.filter((r) => r.wrongAnswer).length;
    if (unanswerable.length) {
      lines.push(
        `questions nothing answers that brought up an owner's answer: ${pulled} of ${unanswerable.length}`,
      );
    }
    const times = results.map((r) => r.embedMs).filter((t): t is number => t !== null);
    const late = times.filter((t) => t > options.waitMs).length;
    lines.push(
      `question vectors: median ${percentile(times, 50)} ms, p95 ${percentile(times, 95)} ms; ` +
        `slower than the ${options.waitMs} ms wait: ${pct(late, times.length)} (first request, no cache)`,
    );
    const relevant = answered.map((r) => r.expectedDistance).filter((d): d is number => d !== null);
    const none = unanswerable.map((r) => r.otherDistance).filter((d): d is number => d !== null);
    if (relevant.length) {
      lines.push(
        `distances: answering chunk median ${percentile(relevant, 50)?.toFixed(3)}, max ${Math.max(...relevant).toFixed(3)}` +
          (none.length
            ? `; nearest chunk for questions nothing answers: min ${Math.min(...none).toFixed(3)}, median ${percentile(none, 50)?.toFixed(3)}`
            : ""),
      );
      lines.push(
        "EMBEDDINGS_MAX_DISTANCE should keep every answering chunk and leave out what's far from any answer.",
      );
    }
  }
  return lines.join("\n");
}
