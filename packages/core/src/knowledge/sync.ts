import { type Db, knowledgeSources, sourceFiles, usageEvents, withTenant } from "@traiblazer/db";
import type { EmbeddingProvider, GatewayResultMeta, LLMGateway } from "@traiblazer/llm";
import { eq } from "drizzle-orm";
import { type CrawlOptions, crawlSite } from "./crawl.js";
import { FileReadError, fileSections, readSourceFile } from "./files.js";
import { type IncomingDocument, indexDocuments } from "./index-documents.js";

export interface SyncDeps {
  db: Db;
  embeddings?: EmbeddingProvider | null;
  /** Reads uploaded photos (a model that can see images); without it photos can't be read. */
  gateway?: LLMGateway | null;
  crawl?: Pick<CrawlOptions, "allowPrivate" | "delayMs" | "timeoutMs">;
}

export const DEFAULT_MAX_PAGES = 50;

/**
 * Re-reads a knowledge source and re-indexes it. The (slow) website crawl and the reading of an
 * uploaded file happen outside any database transaction; indexing runs in one tenant-scoped
 * transaction.
 *
 * An uploaded file is read once: its text is kept on the source and the file is removed. Later
 * refreshes re-index that text, so a photo is never sent to a model twice.
 */
export async function syncSource(deps: SyncDeps, tenantId: string, sourceId: string): Promise<void> {
  const source = await withTenant(deps.db, tenantId, async (tx) => {
    const [row] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)).limit(1);
    if (row) {
      await tx
        .update(knowledgeSources)
        .set({ status: "processing", error: null })
        .where(eq(knowledgeSources.id, sourceId));
    }
    return row;
  });
  if (!source) return; // deleted meanwhile

  /** Model calls made to read a photo: recorded as usage whether or not text came out. */
  const modelCalls: GatewayResultMeta[] = [];
  try {
    let docs: IncomingDocument[];
    /** Text just read from an uploaded file, to keep on the source. */
    let fileText: string | null = null;
    if (source.type === "website") {
      const pages = await crawlSite(source.url!, {
        ...deps.crawl,
        maxPages: source.settings.maxPages ?? DEFAULT_MAX_PAGES,
      });
      if (!pages.length) throw new Error("No readable pages were found at this address.");
      docs = pages.map((p) => ({
        url: p.url,
        title: p.title,
        language: p.language,
        sections: p.sections,
        text: p.text,
      }));
    } else if (source.type === "text") {
      const text = source.content ?? "";
      const sections = text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => ({ heading: null, text: block }));
      docs = [{ url: `text:${source.id}`, title: source.title, language: null, sections, text }];
    } else if (source.type === "file") {
      let text = source.content ?? "";
      if (!text) {
        const [file] = await withTenant(deps.db, tenantId, (tx) =>
          tx.select().from(sourceFiles).where(eq(sourceFiles.sourceId, sourceId)).limit(1),
        );
        if (!file) throw new FileReadError("This file is no longer stored. Delete it and upload it again.");
        text = await readSourceFile(
          { bytes: file.bytes, contentType: file.contentType },
          { gateway: deps.gateway, onModelCall: (meta) => modelCalls.push(meta) },
        );
        fileText = text;
      }
      docs = [
        { url: `file:${source.id}`, title: source.title, language: null, sections: fileSections(text), text },
      ];
    } else {
      throw new Error(`Source type "${source.type}" is not synced by the worker`);
    }

    await withTenant(deps.db, tenantId, async (tx) => {
      const result = await indexDocuments(tx, {
        tenantId,
        botId: source.botId,
        sourceId,
        docs,
        removeMissing: true,
        embeddings: deps.embeddings,
      });
      await tx
        .update(knowledgeSources)
        .set({
          status: "ready",
          error: null,
          documentCount: result.documents,
          lastSyncedAt: new Date(),
          ...(fileText ? { content: fileText } : {}),
        })
        .where(eq(knowledgeSources.id, sourceId));
      // The text is what the assistant uses; the file itself isn't kept.
      if (fileText) await tx.delete(sourceFiles).where(eq(sourceFiles.sourceId, sourceId));
      if (source.type === "website") {
        await tx.insert(usageEvents).values({
          tenantId,
          botId: source.botId,
          kind: "crawl.page",
          quantity: docs.length,
          metadata: { sourceId, changed: result.changed },
        });
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(deps.db, tenantId, (tx) =>
      tx
        .update(knowledgeSources)
        .set({ status: "failed", error: message.slice(0, 500) })
        .where(eq(knowledgeSources.id, sourceId)),
    );
    // A file that can't be read won't read better on a second try: the owner sees why instead.
    if (!(error instanceof FileReadError)) throw error;
  } finally {
    if (modelCalls.length) {
      await withTenant(deps.db, tenantId, (tx) =>
        tx.insert(usageEvents).values(
          modelCalls.map((call) => ({
            tenantId,
            botId: source.botId,
            kind: "llm.agent",
            quantity: call.usage.inputTokens + call.usage.outputTokens,
            costMicros: call.costMicros,
            metadata: {
              task: "file_read",
              sourceId,
              provider: call.provider,
              model: call.model,
              ...call.usage,
            },
          })),
        ),
      );
    }
  }
}
