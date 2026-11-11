import { createHash } from "node:crypto";
import { chunks, documents, type Tx } from "@traiblazer/db";
import type { EmbeddingProvider } from "@traiblazer/llm";
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

/**
 * Upserts documents for one source and rebuilds chunks for documents whose content changed.
 * With `removeMissing`, documents of the source that are no longer present are deleted.
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
    embeddings?: EmbeddingProvider | null;
  },
): Promise<{ documents: number; changed: number; chunks: number }> {
  const keepIds: string[] = [];
  let changed = 0;
  let chunkCount = 0;

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
    if (existing) {
      await tx
        .update(documents)
        .set({ title: doc.title, language: doc.language, contentHash, content: doc.text })
        .where(eq(documents.id, existing.id));
      await tx.delete(chunks).where(eq(chunks.documentId, existing.id));
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
    if (!pieces.length) continue;
    const vectors = input.embeddings
      ? await input.embeddings.embed(
          pieces.map((p) => (p.heading ? `${p.heading}\n${p.content}` : p.content)),
          "document",
        )
      : null;

    await tx.insert(chunks).values(
      pieces.map((piece, ordinal) => {
        const searchable = piece.heading ? `${piece.heading}\n${piece.content}` : piece.content;
        return {
          tenantId: input.tenantId,
          botId: input.botId,
          documentId,
          ordinal,
          heading: piece.heading,
          content: piece.content,
          language: doc.language,
          tsv: tsvectorSql(searchable, doc.language) as unknown as string,
          embedding: vectors?.[ordinal] ?? null,
          embeddingModel: vectors ? input.embeddings!.model : null,
        };
      }),
    );
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

  return { documents: keepIds.length, changed, chunks: chunkCount };
}

/** Deletes every document (and chunk) of a source. */
export async function clearSource(tx: Tx, sourceId: string): Promise<void> {
  await tx.delete(documents).where(inArray(documents.sourceId, [sourceId]));
}
