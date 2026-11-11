import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { enqueueJob, guessLanguage, JOB_TYPES, tsvectorSql } from "@traiblazer/core";
import {
  assets,
  bots,
  conversations,
  documents,
  knowledgeImages,
  knowledgeSources,
  messageAttachments,
  messages,
  qaPairs,
  sourceFiles,
  tenants,
  withTenant,
} from "@traiblazer/db";
import {
  createKnowledgeImageSchema,
  createSourceSchema,
  MAX_KNOWLEDGE_IMAGE_BYTES,
  MAX_SOURCE_FILE_BYTES,
  qaPairSchema,
  SOURCE_FILE_LIMIT,
  updateKnowledgeImageSchema,
  updateTextSourceSchema,
  uploadSourceFileSchema,
} from "@traiblazer/shared";
import { and, asc, count, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { prepareChatImage, sniffSourceFileType, stripImageMetadata } from "../lib/images.js";
import { requireTenantRole } from "../plugins/auth.js";
import { publicAssetUrl } from "./assets.js";

type BotParams = { Params: { tenantId: string; botId: string } };
type ItemParams = { Params: { tenantId: string; botId: string; itemId: string } };

/** Search text and language for a photo: what the assistant matches visitors' questions against. */
function photoSearch(title: string, description: string) {
  const text = `${title}\n${description}`;
  const language = guessLanguage(text);
  return { language, tsv: tsvectorSql(text, language) as unknown as string };
}

/** Quick, DNS-free rejection of obviously private targets; the worker re-checks every request. */
export function assertLooksPublic(url: string) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIP(host)) {
    throw badRequest("Please enter the public address of your website, e.g. https://www.example.com");
  }
}

export async function knowledgeRoutes(app: FastifyInstance, { db, config, platform }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots/:botId";

  /** Runs fn in the tenant's scope after checking the bot exists there. */
  const forBot = async <T>(tenantId: string, botId: string, fn: Parameters<typeof withTenant<T>>[2]) => {
    if (!isUuid(botId)) throw notFound("Assistant");
    return withTenant(db, tenantId, async (tx) => {
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      return fn(tx);
    });
  };

  // ---- Sources ------------------------------------------------------------------------------

  app.get<BotParams>(`${base}/sources`, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { tenantId, botId } = request.params;
    const sources = await forBot(tenantId, botId, (tx) =>
      tx
        .select({
          id: knowledgeSources.id,
          type: knowledgeSources.type,
          title: knowledgeSources.title,
          url: knowledgeSources.url,
          status: knowledgeSources.status,
          error: knowledgeSources.error,
          documentCount: knowledgeSources.documentCount,
          lastSyncedAt: knowledgeSources.lastSyncedAt,
          createdAt: knowledgeSources.createdAt,
          settings: knowledgeSources.settings,
        })
        .from(knowledgeSources)
        .where(eq(knowledgeSources.botId, botId))
        .orderBy(desc(knowledgeSources.createdAt)),
    );
    return {
      sources: sources.map(({ settings, ...source }) => ({
        ...source,
        fileName: settings.file?.name ?? null,
        /** The setup interview's answers: edited through the interview. */
        interview: Boolean(settings.interview),
      })),
    };
  });

  app.post<BotParams>(
    `${base}/sources`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId } = request.params;
      const input = createSourceSchema.parse(request.body);
      if (input.type === "website") assertLooksPublic(input.url);

      const source = await forBot(tenantId, botId, async (tx) => {
        const [row] = await tx
          .insert(knowledgeSources)
          .values(
            input.type === "website"
              ? {
                  tenantId,
                  botId,
                  type: "website",
                  title: input.title ?? new URL(input.url).hostname,
                  url: input.url,
                  settings: input.maxPages ? { maxPages: input.maxPages } : {},
                }
              : { tenantId, botId, type: "text", title: input.title, content: input.content },
          )
          .returning();
        await audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: "source.created",
          targetType: "knowledge_source",
          targetId: row!.id,
          metadata: { type: input.type },
        });
        return row!;
      });
      await enqueueJob(db, { tenantId, type: JOB_TYPES.sourceSync, payload: { sourceId: source.id } });
      return reply.code(201).send({ source });
    },
  );

  /**
   * Uploads a price list, menu or brochure (PDF, Word document or photo). The worker reads it into
   * text, which becomes the source's content; the file itself is private and removed once read.
   */
  app.post<BotParams>(
    `${base}/sources/file`,
    {
      preHandler: requireTenantRole(db, "editor"),
      bodyLimit: Math.ceil((MAX_SOURCE_FILE_BYTES * 4) / 3) + 16 * 1024,
    },
    async (request, reply) => {
      const { tenantId, botId } = request.params;
      const input = uploadSourceFileSchema.parse(request.body);
      const raw = Buffer.from(input.data, "base64");
      if (!raw.length || raw.length > MAX_SOURCE_FILE_BYTES) {
        throw badRequest("Files must be smaller than 5 MB");
      }
      const contentType = sniffSourceFileType(raw);
      // Photos lose their metadata (where and when they were taken) before they are stored.
      const bytes = contentType?.startsWith("image/")
        ? stripImageMetadata(raw, contentType as "image/png" | "image/jpeg" | "image/webp")
        : raw;
      if (!contentType || !bytes) {
        throw badRequest("Please upload a PDF, a Word document (.docx) or a photo (PNG, JPEG or WebP)");
      }

      const source = await forBot(tenantId, botId, async (tx) => {
        const [used] = await tx
          .select({ n: count() })
          .from(knowledgeSources)
          .where(and(eq(knowledgeSources.botId, botId), eq(knowledgeSources.type, "file")));
        if ((used?.n ?? 0) >= SOURCE_FILE_LIMIT) {
          throw new HttpError(
            409,
            "file_limit",
            `An assistant can have up to ${SOURCE_FILE_LIMIT} uploaded files. Delete one to add another.`,
          );
        }
        const [row] = await tx
          .insert(knowledgeSources)
          .values({
            tenantId,
            botId,
            type: "file",
            title: input.title ?? (input.name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || input.name),
            settings: { file: { name: input.name, contentType, sizeBytes: bytes.length } },
          })
          .returning();
        await tx.insert(sourceFiles).values({
          sourceId: row!.id,
          tenantId,
          contentType,
          bytes,
          sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        await audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: "source.created",
          targetType: "knowledge_source",
          targetId: row!.id,
          metadata: { type: "file", contentType, sizeBytes: bytes.length },
        });
        return row!;
      });
      await enqueueJob(db, { tenantId, type: JOB_TYPES.sourceSync, payload: { sourceId: source.id } });
      const { settings, ...created } = source;
      return reply.code(201).send({ source: { ...created, fileName: settings.file?.name ?? null } });
    },
  );

  /**
   * One source with its content: the pasted text, the text read from an uploaded file, or the list
   * of pages read from a website.
   */
  app.get<ItemParams>(
    `${base}/sources/:itemId`,
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Source");
      return forBot(tenantId, botId, async (tx) => {
        const [source] = await tx
          .select()
          .from(knowledgeSources)
          .where(and(eq(knowledgeSources.id, itemId), eq(knowledgeSources.botId, botId)))
          .limit(1);
        if (!source) throw notFound("Source");
        const pages =
          source.type === "website"
            ? await tx
                .select({ title: documents.title, url: documents.url })
                .from(documents)
                .where(eq(documents.sourceId, itemId))
                .orderBy(documents.url)
            : [];
        return {
          source: {
            id: source.id,
            type: source.type,
            title: source.title,
            url: source.url,
            content: source.content,
            fileName: source.settings.file?.name ?? null,
            fileType: source.settings.file?.contentType ?? null,
            status: source.status,
            error: source.error,
            documentCount: source.documentCount,
            lastSyncedAt: source.lastSyncedAt,
            updatedAt: source.updatedAt,
          },
          pages,
        };
      });
    },
  );

  /** Edits pasted text (title and/or content) and re-indexes it in the background. */
  app.patch<ItemParams>(
    `${base}/sources/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Source");
      const input = updateTextSourceSchema.parse(request.body);
      const source = await forBot(tenantId, botId, async (tx) => {
        const [current] = await tx
          .select({ type: knowledgeSources.type, settings: knowledgeSources.settings })
          .from(knowledgeSources)
          .where(and(eq(knowledgeSources.id, itemId), eq(knowledgeSources.botId, botId)))
          .limit(1);
        if (!current) throw notFound("Source");
        if (current.type !== "text")
          throw badRequest("Only pasted text can be edited. Refresh websites instead.");
        if (current.settings.interview) {
          throw badRequest("These are your interview answers: change them in the interview.");
        }
        const [row] = await tx
          .update(knowledgeSources)
          .set({ ...input, status: "pending", error: null })
          .where(eq(knowledgeSources.id, itemId))
          .returning({
            id: knowledgeSources.id,
            type: knowledgeSources.type,
            title: knowledgeSources.title,
            content: knowledgeSources.content,
            status: knowledgeSources.status,
          });
        await audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: "source.updated",
          targetType: "knowledge_source",
          targetId: itemId,
          metadata: { fields: Object.keys(input) },
        });
        return row!;
      });
      await enqueueJob(db, { tenantId, type: JOB_TYPES.sourceSync, payload: { sourceId: itemId } });
      return { source };
    },
  );

  app.post<ItemParams>(
    `${base}/sources/:itemId/sync`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Source");
      await forBot(tenantId, botId, async (tx) => {
        const [row] = await tx
          .update(knowledgeSources)
          .set({ status: "pending", error: null })
          .where(and(eq(knowledgeSources.id, itemId), eq(knowledgeSources.botId, botId)))
          .returning({ id: knowledgeSources.id });
        if (!row) throw notFound("Source");
      });
      await enqueueJob(db, { tenantId, type: JOB_TYPES.sourceSync, payload: { sourceId: itemId } });
      return reply.code(202).send({ queued: true });
    },
  );

  app.delete<ItemParams>(
    `${base}/sources/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Source");
      await forBot(tenantId, botId, async (tx) => {
        const deleted = await tx
          .delete(knowledgeSources)
          .where(and(eq(knowledgeSources.id, itemId), eq(knowledgeSources.botId, botId)))
          .returning({ id: knowledgeSources.id });
        if (!deleted.length) throw notFound("Source");
        await audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: "source.deleted",
          targetType: "knowledge_source",
          targetId: itemId,
        });
      });
      return reply.code(204).send();
    },
  );

  // ---- Q&A pairs ----------------------------------------------------------------------------

  app.get<BotParams>(`${base}/qa`, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { tenantId, botId } = request.params;
    const pairs = await forBot(tenantId, botId, (tx) =>
      tx
        .select({
          id: qaPairs.id,
          question: qaPairs.question,
          answer: qaPairs.answer,
          language: qaPairs.language,
          enabled: qaPairs.enabled,
        })
        .from(qaPairs)
        .where(eq(qaPairs.botId, botId))
        .orderBy(desc(qaPairs.createdAt)),
    );
    return { pairs };
  });

  app.post<BotParams>(
    `${base}/qa`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId } = request.params;
      const input = qaPairSchema.parse(request.body);
      const language = input.language ?? "en";
      const pair = await forBot(tenantId, botId, async (tx) => {
        const [row] = await tx
          .insert(qaPairs)
          .values({
            tenantId,
            botId,
            question: input.question,
            answer: input.answer,
            language,
            tsv: tsvectorSql(`${input.question}\n${input.answer}`, language) as unknown as string,
          })
          .returning({
            id: qaPairs.id,
            question: qaPairs.question,
            answer: qaPairs.answer,
            language: qaPairs.language,
            enabled: qaPairs.enabled,
          });
        return row!;
      });
      return reply.code(201).send({ pair });
    },
  );

  app.delete<ItemParams>(
    `${base}/qa/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Answer");
      await forBot(tenantId, botId, async (tx) => {
        const deleted = await tx
          .delete(qaPairs)
          .where(and(eq(qaPairs.id, itemId), eq(qaPairs.botId, botId)))
          .returning({ id: qaPairs.id });
        if (!deleted.length) throw notFound("Answer");
      });
      return reply.code(204).send();
    },
  );

  // ---- Photos ---------------------------------------------------------------------------------
  // Business photos the assistant can show visitors. Public once added (like the website).

  const photoColumns = {
    id: knowledgeImages.id,
    assetId: knowledgeImages.assetId,
    title: knowledgeImages.title,
    description: knowledgeImages.description,
    enabled: knowledgeImages.enabled,
    createdAt: knowledgeImages.createdAt,
  };
  const withUrl = <T extends { assetId: string }>(row: T) => ({
    ...row,
    url: publicAssetUrl(config.PUBLIC_URL, row.assetId),
  });
  const photoLimit = async (tenantId: string) => {
    const [tenant] = await db
      .select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return (await platform!.plan(tenant?.plan ?? "trial")).knowledgeImages;
  };

  app.get<BotParams>(`${base}/images`, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { tenantId, botId } = request.params;
    const rows = await forBot(tenantId, botId, (tx) =>
      tx
        .select(photoColumns)
        .from(knowledgeImages)
        .where(eq(knowledgeImages.botId, botId))
        .orderBy(asc(knowledgeImages.createdAt)),
    );
    return { images: rows.map(withUrl), limit: await photoLimit(tenantId) };
  });

  app.post<BotParams>(
    `${base}/images`,
    {
      preHandler: requireTenantRole(db, "editor"),
      bodyLimit: Math.ceil((MAX_KNOWLEDGE_IMAGE_BYTES * 4) / 3) + 16 * 1024,
    },
    async (request, reply) => {
      const { tenantId, botId } = request.params;
      const input = createKnowledgeImageSchema.parse(request.body);
      const prepared = prepareChatImage(input.data, MAX_KNOWLEDGE_IMAGE_BYTES);
      if (!prepared.ok) {
        throw badRequest(
          prepared.reason === "size"
            ? "Photos must be smaller than 2 MB"
            : "Please upload a PNG, JPEG or WebP image",
        );
      }
      const limit = await photoLimit(tenantId);
      const image = await forBot(tenantId, botId, async (tx) => {
        const [used] = await tx
          .select({ n: count() })
          .from(knowledgeImages)
          .where(eq(knowledgeImages.botId, botId));
        if ((used?.n ?? 0) >= limit) {
          throw new HttpError(409, "photo_limit", `Your plan allows ${limit} photos per assistant`);
        }
        const [asset] = await tx
          .insert(assets)
          .values({
            tenantId,
            kind: "knowledge_image",
            contentType: prepared.contentType,
            bytes: prepared.bytes,
            sizeBytes: prepared.bytes.length,
            sha256: createHash("sha256").update(prepared.bytes).digest("hex"),
          })
          .returning({ id: assets.id });
        const [row] = await tx
          .insert(knowledgeImages)
          .values({
            tenantId,
            botId,
            assetId: asset!.id,
            title: input.title,
            description: input.description,
            ...photoSearch(input.title, input.description),
          })
          .returning(photoColumns);
        await audit(tx, {
          tenantId,
          actorUserId: request.user?.id ?? null,
          action: "knowledge_image.create",
          targetType: "knowledge_image",
          targetId: row!.id,
        });
        return row!;
      });
      return reply.code(201).send({ image: withUrl(image) });
    },
  );

  app.patch<ItemParams>(
    `${base}/images/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Photo");
      const input = updateKnowledgeImageSchema.parse(request.body);
      const image = await forBot(tenantId, botId, async (tx) => {
        const [current] = await tx
          .select(photoColumns)
          .from(knowledgeImages)
          .where(and(eq(knowledgeImages.id, itemId), eq(knowledgeImages.botId, botId)))
          .limit(1);
        if (!current) throw notFound("Photo");
        const title = input.title ?? current.title;
        const description = input.description ?? current.description;
        const [row] = await tx
          .update(knowledgeImages)
          .set({
            title,
            description,
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...photoSearch(title, description),
            updatedAt: new Date(),
          })
          .where(eq(knowledgeImages.id, itemId))
          .returning(photoColumns);
        return row!;
      });
      return { image: withUrl(image) };
    },
  );

  app.delete<ItemParams>(
    `${base}/images/:itemId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Photo");
      await forBot(tenantId, botId, async (tx) => {
        const [row] = await tx
          .delete(knowledgeImages)
          .where(and(eq(knowledgeImages.id, itemId), eq(knowledgeImages.botId, botId)))
          .returning({ assetId: knowledgeImages.assetId });
        if (!row) throw notFound("Photo");
        // The picture stops being public too.
        await tx.delete(assets).where(eq(assets.id, row.assetId));
        await audit(tx, {
          tenantId,
          actorUserId: request.user?.id ?? null,
          action: "knowledge_image.delete",
          targetType: "knowledge_image",
          targetId: itemId,
        });
      });
      return reply.code(204).send();
    },
  );

  // ---- Conversations (read-only) ------------------------------------------------------------

  app.get<BotParams>(
    `${base}/conversations`,
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const { tenantId, botId } = request.params;
      const list = await forBot(tenantId, botId, (tx) =>
        tx
          .select()
          .from(conversations)
          .where(eq(conversations.botId, botId))
          .orderBy(desc(conversations.lastMessageAt))
          .limit(50),
      );
      return { conversations: list };
    },
  );

  app.get<ItemParams>(
    `${base}/conversations/:itemId`,
    { preHandler: requireTenantRole(db, "viewer") },
    async (request) => {
      const { tenantId, botId, itemId } = request.params;
      if (!isUuid(itemId)) throw notFound("Conversation");
      return forBot(tenantId, botId, async (tx) => {
        const [conversation] = await tx
          .select()
          .from(conversations)
          .where(and(eq(conversations.id, itemId), eq(conversations.botId, botId)))
          .limit(1);
        if (!conversation) throw notFound("Conversation");
        const rows = await tx
          .select()
          .from(messages)
          .where(eq(messages.conversationId, itemId))
          .orderBy(messages.createdAt);
        return {
          conversation,
          messages: rows.map((m) => ({
            ...m,
            images: m.images.map((image) => ({
              ...image,
              url: publicAssetUrl(config.PUBLIC_URL, image.assetId),
            })),
          })),
        };
      });
    },
  );

  // Images visitors sent in a conversation. Visitor data: private, never cached by shared caches.
  app.get<{ Params: { tenantId: string; botId: string; itemId: string; attachmentId: string } }>(
    `${base}/conversations/:itemId/attachments/:attachmentId`,
    { preHandler: requireTenantRole(db, "viewer") },
    async (request, reply) => {
      const { tenantId, botId, itemId, attachmentId } = request.params;
      if (!isUuid(itemId) || !isUuid(attachmentId)) throw notFound("Image");
      const image = await forBot(tenantId, botId, async (tx) => {
        const [row] = await tx
          .select({
            contentType: messageAttachments.contentType,
            dataBase64: messageAttachments.dataBase64,
          })
          .from(messageAttachments)
          .where(
            and(
              eq(messageAttachments.id, attachmentId),
              eq(messageAttachments.conversationId, itemId),
              eq(messageAttachments.botId, botId),
            ),
          )
          .limit(1);
        return row;
      });
      if (!image) throw notFound("Image");
      return reply
        .type(image.contentType)
        .header("cache-control", "private, max-age=3600")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .send(Buffer.from(image.dataBase64, "base64"));
    },
  );
}
