import { createHash } from "node:crypto";
import { chunks, documents, type Tx } from "@traiblazer/db";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { chunkSections } from "./chunk.js";
import type { Section } from "./extract.js";

export interface IncomingDocument {
  url: string | null;
  title: string | null;
  language: string | null;
  sections: Section[];
  text: string;
}

/** Postgres text-search configuration for a language (stemming); "simple" otherwise. */
export function tsConfigFor(language: string | null | undefined): string {
  const base = (language ?? "").toLowerCase().split("-")[0];
  const map: Record<string, string> = {
    en: "english",
    fr: "french",
    es: "spanish",
    pt: "portuguese",
    ru: "russian",
    tr: "turkish",
    it: "italian",
    de: "german",
  };
  return map[base ?? ""] ?? "simple";
}

/**
 * Full-text vector: language-agnostic tokens plus stemmed tokens for the document's language.
 * Text of unknown language (pasted text, files, pages without a lang attribute) is stemmed as both
 * English and French, so "senior" still finds "Seniors get 10% off". Keep in step with migration
 * 0034, which rebuilt the vectors of chunks indexed before.
 */
export function tsvectorSql(text: string, language: string | null | undefined) {
  if (!language?.trim()) {
    return sql`to_tsvector('simple', ${text}) || to_tsvector('english', ${text}) || to_tsvector('french', ${text})`;
  }
  return sql`to_tsvector('simple', ${text}) || to_tsvector(${tsConfigFor(language)}::regconfig, ${text})`;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The text a chunk is searched (and embedded) by. Migration 0038 hashes the same text. */
export const searchableText = (chunk: { heading: string | null; content: string }) =>
  chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content;

/**
 * Upserts documents for one source and rebuilds chunks for documents whose content changed.
 * With `removeMissing`, documents of the source that are no longer present are deleted.
 * Makes no network calls: new chunks are searchable by keyword at once, and get their vectors from
 * the `embed.chunks` job (embed.ts). A chunk whose text is already embedded elsewhere in the assistant
 * (the unchanged paragraphs of a changed page, a footer repeated on every page) keeps that vector.
 * Must run inside withTenant().
 */
export async function indexDocuments(
  tx: Tx,
  input: {
    tenantId: string;
    botId: string;
    sourceId: string;
    docs: IncomingDocument[];
    removeMissing: boolean;
  },
): Promise<{ documents: number; changed: number; chunks: number; unembedded: number }> {
  const keepIds: string[] = [];
  let changed = 0;
  let chunkCount = 0;
  let unembedded = 0;

  for (const doc of input.docs) {
    const contentHash = sha256(doc.text);
    const [existing] = doc.url
      ? await tx
          .select({ id: documents.id, contentHash: documents.contentHash })
          .from(documents)
          .where(and(eq(documents.sourceId, input.sourceId), eq(documents.url, doc.url)))
          .limit(1)
      : [];

    if (existing && existing.contentHash === contentHash) {
      keepIds.push(existing.id);
      continue;
    }

    let documentId: string;
    /** The document's chunks before this change: removed once their vectors were reused. */
    let previous: string[] = [];
    if (existing) {
      await tx
        .update(documents)
        .set({ title: doc.title, language: doc.language, contentHash, content: doc.text })
        .where(eq(documents.id, existing.id));
      previous = (
        await tx.select({ id: chunks.id }).from(chunks).where(eq(chunks.documentId, existing.id))
      ).map((c) => c.id);
      documentId = existing.id;
    } else {
      const [created] = await tx
        .insert(documents)
        .values({
          tenantId: input.tenantId,
          botId: input.botId,
          sourceId: input.sourceId,
          url: doc.url,
          title: doc.title,
          language: doc.language,
          contentHash,
          content: doc.text,
        })
        .returning({ id: documents.id });
      documentId = created!.id;
    }
    keepIds.push(documentId);
    changed++;

    const pieces = chunkSections(doc.sections, { title: doc.title });
    if (pieces.length) {
      const inserted = await tx
        .insert(chunks)
        .values(
          pieces.map((piece, ordinal) => {
            const searchable = searchableText(piece);
            return {
              tenantId: input.tenantId,
              botId: input.botId,
              documentId,
              ordinal,
              heading: piece.heading,
              content: piece.content,
              language: doc.language,
              tsv: tsvectorSql(searchable, doc.language) as unknown as string,
              contentHash: sha256(searchable),
            };
          }),
        )
        .returning({ id: chunks.id });
      unembedded += await reuseVectors(
        tx,
        input.botId,
        inserted.map((c) => c.id),
      );
    }
    if (previous.length) await tx.delete(chunks).where(inArray(chunks.id, previous));
    chunkCount += pieces.length;
  }

  if (input.removeMissing) {
    await tx
      .delete(documents)
      .where(
        keepIds.length
          ? and(eq(documents.sourceId, input.sourceId), notInArray(documents.id, keepIds))
          : eq(documents.sourceId, input.sourceId),
      );
  }

  return { documents: keepIds.length, changed, chunks: chunkCount, unembedded };
}

/**
 * Copies vectors from chunks of the same assistant with the same text onto new chunks; returns how
 * many new chunks still have none. A vector of another model is copied too: the embedding job
 * replaces it like any vector of an old model.
 */
async function reuseVectors(tx: Tx, botId: string, ids: string[]): Promise<number> {
  await tx.execute(sql`
    update chunks n
       set embedding = o.embedding, embedding_model = o.embedding_model
      from (select distinct on (content_hash) content_hash, embedding, embedding_model
              from chunks
             where bot_id = ${botId} and embedding is not null
               and content_hash in (select content_hash from chunks where id in ${ids})
             order by content_hash, created_at desc) o
     where n.id in ${ids} and n.embedding is null and n.content_hash = o.content_hash`);
  const [row] = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from chunks where id in ${ids} and embedding is null`,
  );
  return Number(row?.n ?? 0);
}

/** Deletes every document (and chunk) of a source. */
export async function clearSource(tx: Tx, sourceId: string): Promise<void> {
  await tx.delete(documents).where(inArray(documents.sourceId, [sourceId]));
}
