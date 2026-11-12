import { chunks, type Db, usageEvents, withTenant } from "@traiblazer/db";
import { type EmbeddingProvider, embeddingCostMicros, type QueryEmbedder } from "@traiblazer/llm";
import { and, eq, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { JOB_TYPES } from "../jobs.js";
import { searchableText } from "./index-documents.js";

/** Chunks embedded per provider call. */
const BATCH = 128;
/** Most batches one job runs (≈ 25,000 chunks); a bigger backlog continues in the next job. */
const MAX_BATCHES = 200;

/**
 * Queues the embedding of an assistant's text (chunks, Q&A pairs, photos), unless one is already waiting (several sources
 * synced together make one job).
 */
export async function enqueueEmbedding(db: Db, tenantId: string, botId: string): Promise<void> {
  await db.execute(sql`
    insert into jobs (tenant_id, type, payload)
    select ${tenantId}, ${JOB_TYPES.embedChunks}, ${JSON.stringify({ botId })}::jsonb
     where not exists (
       select 1 from jobs
        where type = ${JOB_TYPES.embedChunks} and status = 'queued' and payload->>'botId' = ${botId})`);
}

/** Chunks with no vector, or a vector of another model. */
const needsVector = (model: string) =>
  or(isNull(chunks.embedding), isNull(chunks.embeddingModel), ne(chunks.embeddingModel, model));

/**
 * Gives an assistant's chunks vectors of the current model: new chunks, and every chunk after a
 * change of model (the backfill). Then the same for the owner's Q&A pairs and photos. Provider calls
 * happen outside any database transaction and are retried by the provider; the job is retried if
 * they still fail. Records the tokens as usage. Returns how many texts were embedded.
 */
export async function embedChunks(
  deps: { db: Db; embeddings: EmbeddingProvider },
  tenantId: string,
  botId: string,
): Promise<{ embedded: number; more: boolean }> {
  const model = deps.embeddings.model;
  let embedded = 0;
  let batches = 0;
  const usage = (tokens: number, task: string, count: number) => ({
    tenantId,
    botId,
    kind: "embedding",
    quantity: tokens,
    costMicros: embeddingCostMicros(deps.embeddings, tokens),
    metadata: { model, task, chunks: count },
  });

  for (; batches < MAX_BATCHES; batches++) {
    const rows = await withTenant(deps.db, tenantId, (tx) =>
      tx
        .select({ id: chunks.id, heading: chunks.heading, content: chunks.content })
        .from(chunks)
        .where(and(eq(chunks.botId, botId), needsVector(model)))
        .orderBy(chunks.createdAt)
        .limit(BATCH),
    );
    if (!rows.length) break;

    const { vectors, tokens } = await deps.embeddings.embed(rows.map(searchableText), "document");
    await withTenant(deps.db, tenantId, async (tx) => {
      for (const [i, row] of rows.entries()) {
        await tx
          .update(chunks)
          .set({ embedding: vectors[i]!, embeddingModel: model })
          .where(eq(chunks.id, row.id));
      }
      await tx.insert(usageEvents).values(usage(tokens, "documents", rows.length));
    });
    embedded += rows.length;
  }

  for (const written of WRITTEN) {
    for (; batches < MAX_BATCHES; batches++) {
      const rows = await withTenant(deps.db, tenantId, (tx) =>
        tx.execute<{ id: string; text: string; hash: string }>(sql`
          select id, ${written.text} as text, md5(${written.text}) as hash
            from ${written.table}
           where bot_id = ${botId} and ${stale(written.text, model)}
           order by created_at
           limit ${BATCH}`),
      );
      if (!rows.length) break;

      const { vectors, tokens } = await deps.embeddings.embed(
        rows.map((r) => r.text),
        "document",
      );
      await withTenant(deps.db, tenantId, async (tx) => {
        for (const [i, row] of rows.entries()) {
          // The hash is of the text that was embedded: an edit made meanwhile shows as stale again.
          await tx.execute(sql`
            update ${written.table}
               set embedding = ${`[${vectors[i]!.join(",")}]`}::halfvec,
                   embedding_model = ${model}, embedding_hash = ${row.hash}
             where id = ${row.id}`);
        }
        await tx.insert(usageEvents).values(usage(tokens, written.task, rows.length));
      });
      embedded += rows.length;
    }
  }
  return { embedded, more: batches >= MAX_BATCHES };
}

/**
 * What the owner writes by hand and visitors' questions are matched against: Q&A pairs and photo
 * descriptions. Their text can be edited in place, so each row keeps a hash of the text its vector
 * was made from; a row is stale when the hash or the model no longer matches. (Services aren't
 * here: the whole list is in every prompt already.)
 */
const WRITTEN = [
  { table: sql`qa_pairs`, text: sql`(question || E'\\n' || answer)`, task: "answers" },
  { table: sql`knowledge_images`, text: sql`(title || E'\\n' || description)`, task: "photos" },
];

const stale = (text: SQL, model: string) =>
  sql`(embedding is null or embedding_model is distinct from ${model}
       or embedding_hash is distinct from md5(${text}))`;

/**
 * Embeds questions visitors are likely to tap (quick replies) ahead of time, so the first tap
 * finds its vector in the cache. Never throws; meant to run without being awaited.
 */
export async function warmQuestions(
  deps: { db: Db; embeddings: QueryEmbedder },
  tenantId: string,
  botId: string,
  questions: string[],
): Promise<void> {
  try {
    const unique = [...new Set(questions.map((q) => q.trim()).filter(Boolean))].slice(0, 40);
    const vectors = await Promise.all(unique.map((q) => deps.embeddings.embed(q)));
    const tokens = vectors.reduce((sum, v) => sum + (v?.tokens ?? 0), 0);
    if (!tokens) return;
    const model = vectors.find((v) => v)?.model;
    await withTenant(deps.db, tenantId, (tx) =>
      tx.insert(usageEvents).values({
        tenantId,
        botId,
        kind: "embedding",
        quantity: tokens,
        costMicros: vectors.reduce((sum, v) => sum + (v?.costMicros ?? 0), 0),
        metadata: { model, task: "quick-replies" },
      }),
    );
  } catch {
    // The first tap embeds the question instead.
  }
}

/** Assistants with text that needs vectors of this model (for the backfill command; owner connection). */
export async function botsNeedingVectors(
  db: Db,
  model: string,
): Promise<{ tenantId: string; botId: string }[]> {
  const found = new Map<string, { tenantId: string; botId: string }>();
  const add = (rows: Iterable<{ tenantId: string; botId: string }>) => {
    for (const row of rows) found.set(row.botId, row);
  };
  add(
    await db
      .selectDistinct({ tenantId: chunks.tenantId, botId: chunks.botId })
      .from(chunks)
      .where(needsVector(model)),
  );
  for (const written of WRITTEN) {
    add(
      await db.execute<{ tenantId: string; botId: string }>(sql`
        select distinct tenant_id as "tenantId", bot_id as "botId"
          from ${written.table} where ${stale(written.text, model)}`),
    );
  }
  return [...found.values()];
}
