import type { Citation, Tx } from "@traiblazer/db";
import { sql } from "drizzle-orm";

export interface Passage {
  key: string;
  kind: Citation["kind"];
  title: string | null;
  url: string | null;
  heading: string | null;
  content: string;
  score: number;
}

const RRF_K = 60;
/** How much a match by meaning counts next to a match by words (1). */
const VECTOR_WEIGHT = 1.2;
/**
 * Q&A pairs and photo descriptions are short, so one that answers the question is much closer to it
 * than a chunk needs to be: they count by meaning only within this share of the model's cutoff
 * (voyage-4-lite: real matches 0.32–0.54, others from 0.57; docs/EMBEDDINGS.md §7).
 */
const SHORT_TEXT_CUTOFF = 0.75;

/** Builds an OR-query of the words in the given texts, safe for to_tsquery (letters/digits only). */
export function toOrQuery(texts: string[]): string | null {
  const words = new Set<string>();
  for (const text of texts) {
    for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      if (w.length > 1 || /[一-鿿]/.test(w)) words.add(w);
      if (words.size >= 40) break;
    }
  }
  return words.size ? [...words].join(" | ") : null;
}

/**
 * The question's words without "do", "you", "the", "vous", "les"… as an OR-query (SQL text, null
 * when none is left): a filler word shared with a text isn't a match. A word counts when both the
 * English and the French dictionaries keep it.
 */
const contentWords = (orQuery: string | null) => sql`(
  select string_agg(w, ' | ')
    from unnest(string_to_array(${orQuery}::text, ' | ')) w
   where length(to_tsvector('english', w)) > 0 and length(to_tsvector('french', w)) > 0)`;

/** Matches the words in any of the three dictionaries the texts are indexed with. */
const anyDictionary = (words: ReturnType<typeof sql>) =>
  sql`(to_tsquery('simple', ${words}) || to_tsquery('english', ${words}) || to_tsquery('french', ${words}))`;

type Row = Record<string, unknown> & {
  id: string;
  heading: string | null;
  content: string;
  title: string | null;
  url: string | null;
  source_type: string;
};

/**
 * Hybrid retrieval for one bot: full-text (simple + English + French stemming), trigram fuzzy
 * matching, and vector similarity when query embeddings are available; merged with reciprocal-rank
 * fusion. Owner-written Q&A pairs are searched too and ranked first when they match.
 * Must run inside withTenant() (row-level security applies).
 */
export async function retrievePassages(
  tx: Tx,
  input: {
    botId: string;
    queries: string[];
    /** The question's vector; only chunks closer than `maxDistance` (cosine) count. */
    embedding?: { vector: number[]; model: string; maxDistance: number } | null;
    limit?: number;
  },
): Promise<Passage[]> {
  const limit = input.limit ?? 6;
  const orQuery = toOrQuery(input.queries);
  const fuzzyText = input.queries.join(" ").slice(0, 500);
  const scores = new Map<string, Passage>();

  const add = (rows: Row[], weight = 1) => {
    rows.forEach((row, rank) => {
      const kind: Citation["kind"] = row.source_type === "website" ? "page" : "text";
      const key = `c:${row.id}`;
      const existing = scores.get(key);
      const score = weight / (RRF_K + rank + 1);
      if (existing) existing.score += score;
      else
        scores.set(key, {
          key,
          kind,
          title: row.title,
          url: row.source_type === "website" ? row.url : null,
          heading: row.heading,
          content: row.content,
          score,
        });
    });
  };

  const select = sql`select c.id, c.heading, c.content, d.title, d.url, s.type as source_type
    from chunks c
    join documents d on d.id = c.document_id
    join knowledge_sources s on s.id = d.source_id`;

  if (orQuery) {
    // Filler words stay in here: the rank sorts them out, and leaving them out found the right text
    // less often in the retrieval evals (docs/EMBEDDINGS.md §7).
    const q = anyDictionary(sql`${orQuery}`);
    add(
      await tx.execute<Row>(sql`${select}
        where c.bot_id = ${input.botId} and c.tsv @@ ${q}
        order by ts_rank_cd(c.tsv, ${q}) desc
        limit 20`),
    );
  }

  if (fuzzyText) {
    add(
      await tx.execute<Row>(sql`${select}
        where c.bot_id = ${input.botId} and word_similarity(${fuzzyText}, c.content) > 0.25
        order by word_similarity(${fuzzyText}, c.content) desc
        limit 20`),
    );
  }

  // Search by meaning: exact distances over the assistant's own chunks (no approximate index needed
  // at a few thousand chunks, docs/EMBEDDINGS.md §4.4). Far-off chunks don't count at all, so a
  // question nothing answers doesn't pull in the least-bad text.
  if (input.embedding) {
    const vec = sql`${`[${input.embedding.vector.join(",")}]`}::halfvec`;
    add(
      await tx.execute<Row>(sql`select * from (
          select c.id, c.heading, c.content, d.title, d.url, s.type as source_type,
                 c.embedding <=> ${vec} as distance
            from chunks c
            join documents d on d.id = c.document_id
            join knowledge_sources s on s.id = d.source_id
           where c.bot_id = ${input.botId} and c.embedding_model = ${input.embedding.model}
        ) near
        where distance < ${input.embedding.maxDistance}
        order by distance
        limit 20`),
      VECTOR_WEIGHT,
    );
  }

  // Owner-written Q&A pairs: strongest signal when the question matches by its words. A pair that
  // only matches by meaning (other words, the other language) joins the ranking with twice a
  // chunk's vector weight instead: close in meaning isn't always the same question.
  const vec = input.embedding ? sql`${`[${input.embedding.vector.join(",")}]`}::halfvec` : null;
  const near = (input.embedding?.maxDistance ?? 0) * SHORT_TEXT_CUTOFF;
  const distance = vec
    ? sql`case when embedding_model = ${input.embedding!.model} then embedding <=> ${vec} end`
    : sql`null::float8`;
  const qaRows = await tx.execute<{
    id: string;
    question: string;
    answer: string;
    match: number;
    distance: number | null;
  }>(sql`
    with q as (select ${contentWords(orQuery)} as words)
    select * from (
      select id, question, answer,
        greatest(similarity(question, ${fuzzyText}),
                 case when tsv @@ ${anyDictionary(sql`q.words`)}
                      then 0.35 else 0 end) as match,
        ${distance} as distance
      from qa_pairs, q
      where bot_id = ${input.botId} and enabled
    ) pairs
    where match >= 0.3 or distance < ${near}
    order by match desc, distance
    limit 20`);
  const qaPassage = (row: (typeof qaRows)[number], score: number): Passage => ({
    key: `q:${row.id}`,
    kind: "qa",
    title: row.question,
    url: null,
    heading: null,
    content: `Q: ${row.question}\nA: ${row.answer}`,
    score,
  });
  const byWords = qaRows.filter((r) => Number(r.match) >= 0.3).slice(0, 3);
  byWords.forEach((row, rank) => {
    scores.set(`q:${row.id}`, qaPassage(row, 1 + 1 / (rank + 1)));
  });
  qaRows
    .filter((r) => r.distance !== null && Number(r.distance) < near)
    .sort((a, b) => Number(a.distance) - Number(b.distance))
    .slice(0, 3)
    .forEach((row, rank) => {
      if (!scores.has(`q:${row.id}`)) {
        scores.set(`q:${row.id}`, qaPassage(row, (2 * VECTOR_WEIGHT) / (RRF_K + rank + 1)));
      }
    });

  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

const MIN_PHOTO_SCORE = 0.3;

/** A business photo that matches the visitor's question (from the knowledge base). */
export interface PhotoPassage {
  id: string;
  assetId: string;
  title: string;
  description: string;
  score: number;
}

/**
 * Photos whose owner-written title or description matches the queries (full text, then fuzzy), or
 * is close to the question in meaning when its vector is given. Must run inside withTenant().
 */
export async function retrievePhotos(
  tx: Tx,
  input: {
    botId: string;
    queries: string[];
    embedding?: { vector: number[]; model: string; maxDistance: number } | null;
    limit?: number;
  },
): Promise<PhotoPassage[]> {
  const orQuery = toOrQuery(input.queries);
  const fuzzyText = input.queries.join(" ").slice(0, 500);
  if (!orQuery && !fuzzyText) return [];
  // A photo close enough in meaning counts as its closeness (1 − distance), next to the keyword score.
  const meaning = input.embedding
    ? sql`case when embedding_model = ${input.embedding.model}
                and embedding <=> ${`[${input.embedding.vector.join(",")}]`}::halfvec < ${input.embedding.maxDistance * SHORT_TEXT_CUTOFF}
           then greatest(${MIN_PHOTO_SCORE}, 1 - (embedding <=> ${`[${input.embedding.vector.join(",")}]`}::halfvec))
           else 0 end`
    : sql`0`;
  const rows = await tx.execute<{
    id: string;
    asset_id: string;
    title: string;
    description: string;
    score: number;
  }>(sql`
    with q as (select ${anyDictionary(contentWords(orQuery))} as words)
    select id, asset_id, title, description,
      greatest(
        case when tsv @@ q.words then 0.3 + ts_rank_cd(tsv, q.words) else 0 end,
        word_similarity(${fuzzyText}, title || ' ' || description),
        ${meaning}
      ) as score
    from knowledge_images, q
    where bot_id = ${input.botId} and enabled
    order by score desc
    limit ${input.limit ?? 3}`);
  return rows
    .filter((r) => Number(r.score) >= MIN_PHOTO_SCORE)
    .map((r) => ({
      id: r.id,
      assetId: r.asset_id,
      title: r.title,
      description: r.description,
      score: Number(r.score),
    }));
}
