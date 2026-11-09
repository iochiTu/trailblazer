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
    embedding?: { vector: number[]; model: string } | null;
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
    const q = sql`(to_tsquery('simple', ${orQuery}) || to_tsquery('english', ${orQuery}) || to_tsquery('french', ${orQuery}))`;
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

  if (input.embedding) {
    const vec = `[${input.embedding.vector.join(",")}]`;
    add(
      await tx.execute<Row>(sql`${select}
        where c.bot_id = ${input.botId} and c.embedding_model = ${input.embedding.model}
        order by c.embedding <=> ${vec}::vector
        limit 20`),
      1.2,
    );
  }

  // Owner-written Q&A pairs: strongest signal when the question matches.
  const qaRows = await tx.execute<{ id: string; question: string; answer: string; match: number }>(sql`
    select id, question, answer,
      greatest(similarity(question, ${fuzzyText}),
               case when ${orQuery}::text is not null
                    and tsv @@ (to_tsquery('simple', coalesce(${orQuery}, '')) || to_tsquery('english', coalesce(${orQuery}, '')) || to_tsquery('french', coalesce(${orQuery}, '')))
                    then 0.35 else 0 end) as match
    from qa_pairs
    where bot_id = ${input.botId} and enabled
    order by match desc
    limit 5`);
  qaRows
    .filter((r) => Number(r.match) >= 0.3)
    .slice(0, 3)
    .forEach((row, rank) => {
      scores.set(`q:${row.id}`, {
        key: `q:${row.id}`,
        kind: "qa",
        title: row.question,
        url: null,
        heading: null,
        content: `Q: ${row.question}\nA: ${row.answer}`,
        score: 1 + 1 / (rank + 1),
      });
    });

  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A business photo that matches the visitor's question (from the knowledge base). */
export interface PhotoPassage {
  id: string;
  assetId: string;
  title: string;
  description: string;
  score: number;
}

/**
 * Photos whose owner-written title or description matches the queries (full text, then fuzzy).
 * Must run inside withTenant().
 */
export async function retrievePhotos(
  tx: Tx,
  input: { botId: string; queries: string[]; limit?: number },
): Promise<PhotoPassage[]> {
  const orQuery = toOrQuery(input.queries);
  const fuzzyText = input.queries.join(" ").slice(0, 500);
  if (!orQuery && !fuzzyText) return [];
  const q = sql`(to_tsquery('simple', coalesce(${orQuery}, '')) || to_tsquery('english', coalesce(${orQuery}, '')) || to_tsquery('french', coalesce(${orQuery}, '')))`;
  const rows = await tx.execute<{
    id: string;
    asset_id: string;
    title: string;
    description: string;
    score: number;
  }>(sql`
    select id, asset_id, title, description,
      greatest(
        case when ${orQuery}::text is not null and tsv @@ ${q} then 0.3 + ts_rank_cd(tsv, ${q}) else 0 end,
        word_similarity(${fuzzyText}, title || ' ' || description)
      ) as score
    from knowledge_images
    where bot_id = ${input.botId} and enabled
    order by score desc
    limit ${input.limit ?? 3}`);
  return rows
    .filter((r) => Number(r.score) >= 0.3)
    .map((r) => ({
      id: r.id,
      assetId: r.asset_id,
      title: r.title,
      description: r.description,
      score: Number(r.score),
    }));
}
