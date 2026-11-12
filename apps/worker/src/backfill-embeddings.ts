/**
 * Queues the embedding of every assistant whose text (chunks, Q&A pairs, photos) has no vector, or a
 * vector of another model or of an older wording:
 * run it after turning embeddings on, or after changing EMBEDDINGS_MODEL or EMBEDDINGS_DIMENSIONS.
 * The worker does the work; until it reaches an assistant, that assistant is searched by keyword.
 *
 *   pnpm embeddings:backfill
 *
 * Reads every business, so it uses the owner connection (DATABASE_URL), like migrations.
 */
import { botsNeedingVectors, enqueueEmbedding } from "@traiblazer/core";
import { createDb } from "@traiblazer/db";
import { createEmbeddingsFromEnv } from "@traiblazer/llm";

const embeddings = createEmbeddingsFromEnv();
if (!embeddings) {
  console.error("Embeddings aren't configured: set EMBEDDINGS_BASE_URL and EMBEDDINGS_MODEL.");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (the owner connection) is required.");
  process.exit(1);
}
const { db, close } = createDb(url, { max: 1 });
const bots = await botsNeedingVectors(db, embeddings.model);
for (const { tenantId, botId } of bots) await enqueueEmbedding(db, tenantId, botId);
console.log(`Queued ${bots.length} assistant(s) for ${embeddings.model}.`);
await close();
