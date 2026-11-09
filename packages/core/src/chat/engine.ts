import {
  type AttachmentRef,
  bots,
  businessProfiles,
  type Channel,
  type Citation,
  conversations,
  type Db,
  type MessageFlags,
  messageAttachments,
  messages,
  type ReplyImage,
  usageEvents,
  withTenant,
} from "@traiblazer/db";
import type {
  ChatMessage,
  ContentBlock,
  EmbeddingProvider,
  GatewayResultMeta,
  ImageMediaType,
  LLMGateway,
} from "@traiblazer/llm";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { guessLanguage, isEnOrFr } from "./language.js";
import { PhotoMarkerFilter } from "./photo-markers.js";
import { buildSearchQueryPrompt, buildSystemBlocks, parseSearchQueries, photoPromptId } from "./prompt.js";
import { type Passage, type PhotoPassage, retrievePassages, retrievePhotos } from "./retrieval.js";

export interface ChatDeps {
  db: Db;
  gateway: LLMGateway;
  embeddings?: EmbeddingProvider | null;
  now?: () => Date;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/** An image the visitor sent, already validated and stripped of metadata by the API. */
export interface ChatImage {
  name: string;
  contentType: ImageMediaType;
  /** Base64, no `data:` prefix. */
  dataBase64: string;
  sizeBytes: number;
  sha256: string;
}

export interface ChatInput {
  tenantId: string;
  botId: string;
  conversationId?: string | null;
  visitorId: string;
  channel: Channel;
  /** The visitor's text; may be empty when images are attached. */
  message: string;
  images?: ChatImage[];
  pageUrl?: string | null;
  signal?: AbortSignal;
}

export type ChatStreamEvent =
  | { type: "start"; conversationId: string }
  | { type: "text"; text: string }
  /** A business photo shown with the reply (sent after the text). */
  | { type: "image"; image: ReplyImage }
  | { type: "done"; messageId: string; citations: Citation[]; flags: MessageFlags }
  | { type: "error"; code: "unavailable" | "failed"; message: string };

const HISTORY_TURNS = 10;
/** Most business photos shown in one reply. */
export const MAX_PHOTOS_PER_REPLY = 2;
export const MAX_MESSAGE_LENGTH = 2000;
/** Most images sent to the model per answer (the newest; older ones become a text placeholder). */
export const MAX_IMAGES_IN_CONTEXT = 4;

/** When the visitor sends images but no configured model can look at them (or offline mode). */
const NO_VISION_TEXT: Record<string, string> = {
  en: "Sorry, I can't look at images right now.",
  fr: "Désolé, je ne peux pas regarder les images pour le moment.",
};
const CONTACT_TEXT: Record<string, { intro: string; phone: string; email: string }> = {
  en: { intro: "You can contact the business directly:", phone: "Phone", email: "Email" },
  fr: {
    intro: "Vous pouvez communiquer directement avec l'entreprise :",
    phone: "Téléphone",
    email: "Courriel",
  },
};
/** Sent to the model in place of the visitor's text when they sent only images. */
const IMAGE_ONLY_TEXT = "(The visitor sent this without a message.)";

/** Text stand-in for an image the model won't see (older than the context window, or no vision). */
const imagePlaceholder = (ref: AttachmentRef) =>
  `[Image sent by the visitor: ${ref.name.replace(/[[\]\n]/g, " ")}]`;

function noVisionText(lang: string, profile: { phone: string | null; email: string | null } | null) {
  const contact = CONTACT_TEXT[lang]!;
  const lines = [
    profile?.phone && `- ${contact.phone}: ${profile.phone}`,
    profile?.email && `- ${contact.email}: ${profile.email}`,
  ].filter(Boolean);
  const notice = NO_VISION_TEXT[lang]!;
  return lines.length ? `${notice} ${contact.intro}\n\n${lines.join("\n")}` : notice;
}

const FALLBACK_TEXT: Record<string, string> = {
  en: "Sorry, I can't help with that here. Please contact the business directly.",
  fr: "Désolé, je ne peux pas vous aider avec cela ici. Veuillez communiquer directement avec l'entreprise.",
};
const ERROR_TEXT: Record<string, string> = {
  en: "Sorry, something went wrong. Please try again in a moment.",
  fr: "Désolé, une erreur s'est produite. Veuillez réessayer dans un instant.",
};
/** When every AI provider route is at capacity (HTTP 429) — a temporary, shared condition. */
const BUSY_TEXT: Record<string, string> = {
  en: "Lots of people are asking questions right now. Please try again in a moment.",
  fr: "Beaucoup de gens posent des questions en ce moment. Veuillez réessayer dans un instant.",
};

/** True for "too many requests" from an AI provider (Anthropic and OpenAI SDK errors carry `status`). */
export const isCapacityError = (error: unknown) => (error as { status?: number } | null)?.status === 429;

/** Sources shown under an answer: distinct web pages among the passages, best first. */
export function citationsFrom(passages: Passage[], max = 3): Citation[] {
  // Only cite pages that matched about as strongly as the best passage; weak matches are context,
  // not the source of the answer.
  const best = passages[0]?.score ?? 0;
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const p of passages) {
    if (p.score < best * 0.6) break;
    if (p.kind !== "page" || !p.url || seen.has(p.url)) continue;
    seen.add(p.url);
    out.push({ kind: "page", title: p.title, url: p.url });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Answers one visitor message: logs it, finds relevant business information, streams the reply,
 * and records the answer with usage and cost. Everything runs under the bot's tenant (RLS).
 */
export async function* runChat(deps: ChatDeps, input: ChatInput): AsyncGenerator<ChatStreamEvent> {
  const started = Date.now();
  const message = input.message.trim().slice(0, MAX_MESSAGE_LENGTH);
  const images = input.images ?? [];
  let language = guessLanguage(message);

  // 1. Load bot + profile, resume or start the conversation, store the visitor's message.
  const setup = await withTenant(deps.db, input.tenantId, async (tx) => {
    const [bot] = await tx.select().from(bots).where(eq(bots.id, input.botId)).limit(1);
    if (!bot || bot.status === "paused") return null;
    const [profile] = await tx
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.botId, bot.id))
      .limit(1);

    let conversation = input.conversationId
      ? (
          await tx
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, input.conversationId),
                eq(conversations.botId, bot.id),
                eq(conversations.visitorId, input.visitorId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
    if (!conversation) {
      [conversation] = await tx
        .insert(conversations)
        .values({
          tenantId: input.tenantId,
          botId: bot.id,
          channel: input.channel,
          visitorId: input.visitorId,
          language,
          pageUrl: input.pageUrl?.slice(0, 2000) ?? null,
        })
        .returning();
    }

    const history = (
      await tx
        .select({ role: messages.role, content: messages.content, attachments: messages.attachments })
        .from(messages)
        .where(eq(messages.conversationId, conversation!.id))
        .orderBy(desc(messages.createdAt))
        .limit(HISTORY_TURNS * 2)
    ).reverse();

    // An image-only message keeps the conversation's language.
    if (!message) language = conversation!.language;

    // The message keeps only references; the image data goes to message_attachments.
    const refs: AttachmentRef[] = images.map((image) => ({
      id: crypto.randomUUID(),
      name: image.name,
      contentType: image.contentType,
      sizeBytes: image.sizeBytes,
    }));
    const [userMessage] = await tx
      .insert(messages)
      .values({
        tenantId: input.tenantId,
        conversationId: conversation!.id,
        role: "user",
        content: message,
        language,
        attachments: refs,
      })
      .returning({ id: messages.id });
    if (images.length) {
      await tx.insert(messageAttachments).values(
        images.map((image, i) => ({
          id: refs[i]!.id,
          tenantId: input.tenantId,
          botId: bot.id,
          conversationId: conversation!.id,
          messageId: userMessage!.id,
          name: image.name,
          contentType: image.contentType,
          sizeBytes: image.sizeBytes,
          sha256: image.sha256,
          dataBase64: image.dataBase64,
        })),
      );
    }

    // Image data for the newest earlier images still within the context budget.
    const budget = Math.max(0, MAX_IMAGES_IN_CONTEXT - images.length);
    const earlier = history.flatMap((m) => (m.role === "user" ? m.attachments : []));
    const wanted = budget ? earlier.slice(-budget).map((a) => a.id) : [];
    const historyImages = new Map(
      wanted.length
        ? (
            await tx
              .select({
                id: messageAttachments.id,
                contentType: messageAttachments.contentType,
                dataBase64: messageAttachments.dataBase64,
              })
              .from(messageAttachments)
              .where(
                and(
                  inArray(messageAttachments.id, wanted),
                  eq(messageAttachments.conversationId, conversation!.id),
                ),
              )
          ).map((row) => [row.id, row])
        : [],
    );
    await tx
      .update(conversations)
      .set({
        messageCount: sql`${conversations.messageCount} + 1`,
        lastMessageAt: new Date(),
        language: language ?? conversation!.language,
      })
      .where(eq(conversations.id, conversation!.id));

    return { bot, profile: profile ?? null, conversationId: conversation!.id, history, historyImages };
  });

  if (!setup) {
    yield { type: "error", code: "unavailable", message: "This assistant is not available right now." };
    return;
  }
  const { bot, profile, conversationId, history, historyImages } = setup;
  const lang2 = language === "fr" ? "fr" : "en";
  yield { type: "start", conversationId };

  // Images reach the model only when a chat route can see them; otherwise they become placeholders
  // and the visitor is told, politely, that images can't be looked at right now.
  const canSee = deps.gateway.supportsImages("chat");
  const toContent = (
    text: string,
    refs: AttachmentRef[],
    data: (ref: AttachmentRef) => { contentType: string; dataBase64: string } | undefined,
  ): ChatMessage["content"] => {
    if (!refs.length) return text;
    const blocks: ContentBlock[] = [];
    const unseen: string[] = [];
    for (const ref of refs) {
      const image = canSee ? data(ref) : undefined;
      if (image) {
        blocks.push({
          type: "image",
          mediaType: image.contentType as ImageMediaType,
          data: image.dataBase64,
        });
      } else unseen.push(imagePlaceholder(ref));
    }
    const body = [...unseen, text || (blocks.length ? IMAGE_ONLY_TEXT : "")].filter(Boolean).join("\n");
    return blocks.length ? [...blocks, { type: "text", text: body }] : body;
  };
  const textHistory = history.map((m) => ({
    role: m.role,
    content: [...m.attachments.map(imagePlaceholder), m.content].filter(Boolean).join("\n"),
  }));
  const modelHistory: ChatMessage[] = history.map((m) => ({
    role: m.role,
    content: toContent(m.content, m.role === "user" ? m.attachments : [], (ref) => historyImages.get(ref.id)),
  }));
  const currentRefs: AttachmentRef[] = images.map((image) => ({
    id: "",
    name: image.name,
    contentType: image.contentType,
    sizeBytes: image.sizeBytes,
  }));
  const current = toContent(message, currentRefs, (ref) => images[currentRefs.indexOf(ref)]);

  let answer = "";
  let chatMeta: GatewayResultMeta | undefined;
  let auxMeta: GatewayResultMeta | undefined;
  let citations: Citation[] = [];
  const flags: MessageFlags = {};
  let offeredPhotos: PhotoPassage[] = [];
  const shownPhotos: ReplyImage[] = [];

  // No model can see the images: say so up front (with the business's contact details).
  let notice = "";
  if (images.length && !canSee) {
    flags.imagesUnseen = true;
    notice = noVisionText(lang2, profile);
    yield { type: "text", text: notice };
  }
  // Text after the notice starts on a new paragraph.
  let separator = notice ? "\n\n" : "";
  const emit = (text: string): ChatStreamEvent => {
    const event = { type: "text" as const, text: separator + text };
    separator = "";
    return event;
  };

  // An image nobody can look at, with no text: the notice is the whole answer.
  if (message || !notice) {
    try {
      // 2. Search queries: rewrite follow-ups and translate other languages into EN/FR.
      let queries = message ? [message] : [];
      if (history.length || (message && !isEnOrFr(language))) {
        const aux = await deps.gateway.complete("aux", {
          ...buildSearchQueryPrompt(textHistory, message || IMAGE_ONLY_TEXT),
          maxTokens: 2000,
          effort: "low",
          signal: input.signal,
        });
        auxMeta = aux;
        queries = parseSearchQueries(aux.text, message || IMAGE_ONLY_TEXT).filter(
          (q) => q !== IMAGE_ONLY_TEXT,
        );
      }

      // 3. Retrieve business information.
      const embedding =
        deps.embeddings && queries.length
          ? {
              vector: (await deps.embeddings.embed([queries.join("\n")], "query"))[0]!,
              model: deps.embeddings.model,
            }
          : null;
      const [passages, photos] = queries.length
        ? await withTenant(deps.db, input.tenantId, async (tx) => [
            await retrievePassages(tx, { botId: bot.id, queries, embedding }),
            await retrievePhotos(tx, { botId: bot.id, queries }),
          ])
        : [[], []];
      offeredPhotos = photos as PhotoPassage[];
      citations = citationsFrom(passages as Passage[]);
      if (!passages.length && !photos.length && queries.length) flags.unanswered = true;

      // 4. Stream the answer. Photo markers are taken out of the text; only photos offered in
      // this prompt can be shown.
      const markers = new PhotoMarkerFilter();
      const byPromptId = new Map(offeredPhotos.map((p, i) => [photoPromptId(i), p]));
      const choose = (ids: string[]) => {
        for (const id of ids) {
          const photo = byPromptId.get(id);
          if (!photo || shownPhotos.some((p) => p.id === photo.id)) continue;
          if (shownPhotos.length < MAX_PHOTOS_PER_REPLY) {
            shownPhotos.push({ id: photo.id, assetId: photo.assetId, title: photo.title });
          }
        }
      };
      for await (const event of deps.gateway.stream("chat", {
        system: buildSystemBlocks({
          bot,
          profile,
          passages: passages as Passage[],
          photos: offeredPhotos,
          now: deps.now?.() ?? new Date(),
        }),
        messages: [...modelHistory, { role: "user", content: current }],
        maxTokens: 16000,
        effort: "low",
        signal: input.signal,
      })) {
        if (event.type === "text") {
          const { text, ids } = markers.push(event.text);
          choose(ids);
          if (text) {
            answer += text;
            yield emit(text);
          }
        } else {
          chatMeta = event;
        }
      }
      const rest = markers.flush();
      if (rest) {
        answer += rest;
        yield emit(rest);
      }

      if (chatMeta?.stopReason === "refusal" || (!answer.trim() && !shownPhotos.length)) {
        shownPhotos.length = 0;
        flags.refused = chatMeta?.stopReason === "refusal" || undefined;
        const fallback = FALLBACK_TEXT[lang2]!;
        yield emit(answer ? `\n\n${fallback}` : fallback);
        answer = answer ? `${answer}\n\n${fallback}` : fallback;
        citations = [];
      }
    } catch (error) {
      if (input.signal?.aborted) return;
      deps.log?.("chat failed", {
        error: error instanceof Error ? error.message : String(error),
        botId: bot.id,
      });
      const busy = isCapacityError(error);
      if (busy) flags.busy = true;
      else flags.error = true;
      const text = (busy ? BUSY_TEXT : ERROR_TEXT)[lang2]!;
      if (!answer) yield emit(text);
      answer = answer || text;
      citations = [];
      shownPhotos.length = 0;
    }
  }
  if (notice) answer = answer ? `${notice}\n\n${answer}` : notice;
  answer = answer.replace(/\n{3,}/g, "\n\n").trim();
  for (const image of shownPhotos) yield { type: "image", image };

  // 5. Store the answer, usage and cost.
  const messageId = await withTenant(deps.db, input.tenantId, async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        tenantId: input.tenantId,
        conversationId,
        role: "assistant",
        content: answer,
        language,
        citations,
        flags,
        images: shownPhotos,
        provider: chatMeta?.provider,
        model: chatMeta?.model,
        inputTokens: chatMeta?.usage.inputTokens,
        outputTokens: chatMeta?.usage.outputTokens,
        cacheReadTokens: chatMeta?.usage.cacheReadTokens,
        cacheWriteTokens: chatMeta?.usage.cacheWriteTokens,
        costMicros: (chatMeta?.costMicros ?? 0) + (auxMeta?.costMicros ?? 0),
        latencyMs: Date.now() - started,
      })
      .returning({ id: messages.id });
    await tx
      .update(conversations)
      .set({ messageCount: sql`${conversations.messageCount} + 1`, lastMessageAt: new Date() })
      .where(eq(conversations.id, conversationId));

    const usage = [
      chatMeta && { kind: "llm.chat", meta: chatMeta },
      auxMeta && { kind: "llm.aux", meta: auxMeta },
    ].filter(Boolean) as { kind: string; meta: GatewayResultMeta }[];
    if (usage.length) {
      await tx.insert(usageEvents).values(
        usage.map(({ kind, meta }) => ({
          tenantId: input.tenantId,
          botId: bot.id,
          kind,
          quantity: meta.usage.inputTokens + meta.usage.outputTokens,
          costMicros: meta.costMicros,
          metadata: { provider: meta.provider, model: meta.model, ...meta.usage },
        })),
      );
    }
    return row!.id;
  });

  yield { type: "done", messageId, citations, flags };
}
