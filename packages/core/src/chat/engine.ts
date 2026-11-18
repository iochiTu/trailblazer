import {
  type AddonContext,
  type AddonEvent,
  addonEffects,
  addonPrompt,
  bookingSettings,
  type CalendarAddonConfig,
  hasEventHandlers,
} from "@traiblazer/addons";
import {
  type AttachmentRef,
  bots,
  businessProfiles,
  type Channel,
  type Citation,
  conversations,
  type Db,
  integrationConnections,
  jobs,
  type MessageFlags,
  messageAttachments,
  messages,
  type ReplyAction,
  type ReplyImage,
  type ReplyItem,
  type ReplyOffer,
  tenants,
  usageEvents,
  withTenant,
} from "@traiblazer/db";
import { enOrFr } from "@traiblazer/i18n";
import { getTemplate } from "@traiblazer/industry-packs";
import { getCalendarConnector, type IntegrationsConfig } from "@traiblazer/integrations";
import {
  type ChatMessage,
  type ContentBlock,
  emptyUsage,
  type GatewayResultMeta,
  type ImageMediaType,
  type LLMGateway,
  type QueryEmbedder,
  type QueryVector,
  toolCallsOf,
  withDeadline,
} from "@traiblazer/llm";
import { DEFAULT_TIME_ZONE } from "@traiblazer/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { businessNameOf, installedAddons, listedCatalogItems, runningNotices } from "../business.js";
import { errorMessage } from "../errors.js";
import { queueInsights } from "../insights/analyze.js";
import { calendarAccess } from "../integrations/calendar.js";
import { JOB_PRIORITY, JOB_TYPES, newJob } from "../jobs.js";
import { textOwnerAboutRequest } from "../sms/alerts.js";
import { countItemEvent, itemStatSurface } from "../stats/item-stats.js";
import { recordGap } from "./gaps.js";
import { guessLanguage, isEnOrFr } from "./language.js";
import { MarkerFilter } from "./markers.js";
import { revealsInstructions, WITHHELD_TEXT } from "./output-check.js";
import { buildSearchQueryPrompt, buildSystemBlocks, parseSearchQueries, photoPromptId } from "./prompt.js";
import { type Passage, type PhotoPassage, searchBotKnowledge } from "./retrieval.js";
import { chatTools, MAX_TOOL_ROUNDS, runToolCalls, toToolDefinition } from "./tools/index.js";
import { higherUrgency, keywordTriage, parseTriage, type Urgency } from "./triage.js";

/** Default wait for the question's vector: catches ~95 % of first-time questions (docs/EMBEDDINGS.md §7). */
const EMBEDDING_WAIT_MS = 250;

export interface ChatDeps {
  db: Db;
  gateway: LLMGateway;
  /** Search by meaning (docs/EMBEDDINGS.md); keyword search alone without it. */
  embeddings?: QueryEmbedder | null;
  /** How long retrieval waits for the question's vector once the keyword search is ready (default 250 ms). */
  embeddingWaitMs?: number;
  now?: () => Date;
  log?: (msg: string, data?: Record<string, unknown>) => void;
  /** Admin portal origin, for links in add-on notifications. */
  adminUrl?: string;
  /** Connected services (the calendar the assistant books in); without it, nothing is booked. */
  integrations?: IntegrationsConfig;
  /** Outbound HTTP for connected services; defaults to one that refuses private addresses. */
  integrationsFetch?: typeof fetch;
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
  /** Take back the reply text sent so far: what follows replaces it (see `retract` in `runChat`). */
  | { type: "reset" }
  /** A business photo shown with the reply (sent after the text). */
  | { type: "image"; image: ReplyImage }
  /**
   * The visitor's message was triaged urgent or a danger: the chat shows the business's phone
   * number at once (with the 911 safety line for a danger). Sent again if a later layer raises it.
   */
  | { type: "urgent"; level: Urgency; phone: string | null }
  /** A button under the reply (sent after the text); the link comes from the business profile. */
  | { type: "action"; action: ReplyAction }
  /** A promotion shown as a card under the reply (sent after the text). */
  | { type: "offer"; offer: ReplyOffer }
  /** A service or product shown as a card under the reply (sent after the text, in order). */
  | { type: "item"; item: ReplyItem }
  | { type: "done"; messageId: string; citations: Citation[]; flags: MessageFlags }
  | { type: "error"; code: "unavailable" | "failed"; message: string };

const HISTORY_TURNS = 10;
/** Most business photos shown in one reply. */
export const MAX_PHOTOS_PER_REPLY = 2;
/** Most service or product cards shown in one reply. */
export const MAX_ITEMS_PER_REPLY = 6;
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

/** The last day something runs ("2026-11-30"), in the business's time zone. */
const lastDay = (endsAt: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(endsAt.getTime() - 1),
  );

/** Adds one model call's usage and cost to the running total for the answer. */
function addMeta(total: GatewayResultMeta | undefined, next: GatewayResultMeta): GatewayResultMeta {
  if (!total) return { ...next, usage: { ...next.usage } };
  const usage = emptyUsage();
  for (const key of Object.keys(usage) as (keyof typeof usage)[]) {
    usage[key] = total.usage[key] + next.usage[key];
  }
  // Provider, model and stop reason are the latest call's; tokens and cost cover every call.
  return { ...next, usage, costMicros: total.costMicros + next.costMicros };
}

/** Passages from several searches as one list, best first, each passage once. */
function mergePassages(...lists: Passage[][]): Passage[] {
  const byKey = new Map<string, Passage>();
  for (const passage of lists.flat()) {
    const existing = byKey.get(passage.key);
    if (!existing || passage.score > existing.score) byKey.set(passage.key, passage);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

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

/** Chat events for add-ons. The owner's own test chat (playground) never triggers them. */
function chatEvents(e: {
  input: ChatInput;
  conversationId: string;
  isNew: boolean;
  message: string;
  answer: string;
  language: string | null;
  flags: MessageFlags;
  /** The visitor's request was passed to staff in this answer. */
  passedOn: boolean;
}): AddonEvent[] {
  if (e.input.channel === "playground") return [];
  const at = new Date();
  const events: AddonEvent[] = [];
  if (e.isNew) {
    events.push({
      type: "conversation.started",
      conversationId: e.conversationId,
      channel: e.input.channel,
      language: e.language,
      message: e.message,
      at,
    });
  }
  // A knowledge gap, not a failed or busy answer (those say nothing about the business's information).
  // When the question was passed to staff it already reaches the business as a request.
  if (e.flags.unanswered && !e.flags.error && !e.flags.busy && !e.passedOn) {
    events.push({
      type: "question.unanswered",
      conversationId: e.conversationId,
      language: e.language,
      question: e.message,
      answer: e.answer,
      at,
    });
  }
  return events;
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
    // The business page: services and products the owner lists, and notices running now.
    const catalog = await listedCatalogItems(tx, bot.id);
    const running = await runningNotices(tx, bot.id, deps.now?.() ?? new Date());

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
    const isNew = !conversation;
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
        .select({
          role: messages.role,
          content: messages.content,
          attachments: messages.attachments,
          flags: messages.flags,
        })
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

    // Add-ons installed on this assistant; the owner's language only matters for notifications.
    const addons = await installedAddons(tx, bot.id);
    // A calendar add-on books only while its calendar is connected and accepted (not flagged).
    const calendarAddon = deps.integrations?.secretKey
      ? addons.find((a) => a.addon.integration && getCalendarConnector(a.addon.integration))
      : undefined;
    const [calendarConnection] = calendarAddon
      ? await tx
          .select({ status: integrationConnections.status })
          .from(integrationConnections)
          .where(
            and(
              eq(integrationConnections.botId, bot.id),
              eq(integrationConnections.provider, calendarAddon.addon.integration!),
            ),
          )
          .limit(1)
      : [];
    const [tenant] = hasEventHandlers(addons)
      ? await tx
          .select({ ownerLanguage: tenants.ownerLanguage })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1)
      : [];
    const addonCtx: AddonContext = {
      tenantId: input.tenantId,
      botId: bot.id,
      businessName: businessNameOf(bot, profile),
      ownerLanguage: enOrFr(tenant?.ownerLanguage),
      adminUrl: deps.adminUrl,
    };

    return {
      bot,
      profile: profile ?? null,
      catalog,
      notices: running.notices,
      offers: running.offers,
      conversationId: conversation!.id,
      isNew,
      history,
      historyImages,
      addons,
      addonCtx,
      calendar:
        calendarAddon && calendarConnection?.status === "connected"
          ? {
              provider: calendarAddon.addon.integration!,
              config: calendarAddon.config as CalendarAddonConfig,
            }
          : null,
    };
  });

  if (!setup) {
    yield { type: "error", code: "unavailable", message: "This assistant is not available right now." };
    return;
  }
  const { bot, profile, conversationId, isNew, history, historyImages, addons, addonCtx } = setup;
  /** The services and products, each with the short id the model names it by. */
  const catalog = setup.catalog.map((item, index) => ({ ...item, ref: `s${index + 1}` }));

  // Search by meaning: the question's vector is asked for now, alongside everything else, and waited
  // for only briefly when the keyword search is ready (docs/EMBEDDINGS.md). A follow-up is embedded
  // with the visitor's question before it, which gives "how much is it?" its subject.
  const previousQuestion = history.findLast((m) => m.role === "user")?.content.trim() ?? "";
  const vectorRequest =
    deps.embeddings && message
      ? deps.embeddings.embed(previousQuestion ? `${previousQuestion}\n${message}` : message)
      : null;
  /** Question vectors computed for this answer (not from a cache), recorded as usage. */
  const embeddingUsage = { tokens: 0, costMicros: 0 };
  const countEmbedding = (vector: QueryVector | null) => {
    if (!vector) return;
    embeddingUsage.tokens += vector.tokens;
    embeddingUsage.costMicros += vector.costMicros;
  };
  // Counted whenever it arrives: a vector that came too late for the search was still paid for.
  void vectorRequest?.then(countEmbedding);
  /** Promotions running now, each with the short id the model names it by. */
  const runningOffers = setup.offers.map((offer, index) => ({ ...offer, ref: `o${index + 1}` }));
  const addonLog = (msg: string, data?: Record<string, unknown>) =>
    deps.log?.(msg, { ...data, botId: bot.id });
  const lang2 = enOrFr(language);
  yield { type: "start", conversationId };

  // Triage, layer 1: the platform's danger words and the industry's urgent words (EN/FR, instant).
  // The auxiliary model's reading (layer 2, any language) can raise it below.
  const template = getTemplate(bot.pack, bot.variant);
  let urgency: Urgency | null = message ? keywordTriage(message, template.triage) : null;
  let advice = false;
  const phone = profile?.phone ?? null;
  if (urgency) yield { type: "urgent", level: urgency, phone };
  /** Raises the triage from the auxiliary model's reply; true when it went up. */
  const applyModelTriage = (output: string) => {
    const read = parseTriage(output);
    advice = read.advice;
    const next = higherUrgency(urgency, read.urgency);
    const raised = next !== urgency;
    urgency = next;
    return raised;
  };

  /**
   * Buttons the reply asked for, resolved from the business profile and its services (never from the
   * model). "quote:s3" is a button for one service: only the button the owner chose for that item,
   * and one such button per reply.
   */
  const shownActions: ReplyAction[] = [];
  const offeredBefore = new Set(
    history.flatMap((m) =>
      ((m.flags as MessageFlags | null)?.actions ?? []).flatMap((a) =>
        a.item ? [`${a.kind}:${a.item.id}`] : [],
      ),
    ),
  );
  const bookingUrl =
    profile?.bookingUrl && /^https?:\/\//i.test(profile.bookingUrl) ? profile.bookingUrl : null;
  const addAction = (marker: string) => {
    const [kind, ref] = marker.split(":");
    if (ref) {
      const item = catalog.find((c) => c.ref === ref);
      if (!item || item.action !== kind || (kind !== "quote" && kind !== "book")) {
        deps.log?.("button dropped", { botId: bot.id, marker });
        return;
      }
      if (shownActions.some((a) => a.item)) return;
      // Once per conversation: the first one stays on screen, and repeating it under every reply
      // (also after the request was passed on) reads as pushing.
      if (offeredBefore.has(`${kind}:${item.id}`)) return;
      shownActions.push({
        kind,
        // Booking opens the business's booking link when it has one; otherwise it starts a request.
        ...(kind === "book" && bookingUrl ? { href: bookingUrl } : {}),
        item: { id: item.id, name: item.name },
      });
      return;
    }
    if (shownActions.some((a) => a.kind === kind && !a.item)) return;
    if (kind === "call" && phone && /\d/.test(phone)) {
      shownActions.push({ kind: "call", href: `tel:${phone.replace(/[^\d+]/g, "")}` });
    } else if (kind === "book" && bookingUrl) {
      shownActions.push({ kind: "book", href: bookingUrl });
    }
  };

  /**
   * Promotions the reply asked to show, in the owner's own words: one per reply, each once per
   * conversation. A promotion about a service brings that service's button with it.
   */
  const shownOffers: ReplyOffer[] = [];
  const offersBefore = new Set(
    history.flatMap((m) => ((m.flags as MessageFlags | null)?.offers ?? []).map((o) => o.id)),
  );
  const addOffer = (ref: string) => {
    const offer = runningOffers.find((o) => o.ref === ref);
    if (!offer) {
      deps.log?.("offer dropped", { botId: bot.id, ref });
      return;
    }
    if (shownOffers.length || offersBefore.has(offer.id)) return;
    shownOffers.push({
      id: offer.id,
      title: offer.title ?? offer.text,
      text: offer.text,
      endsAt: offer.endsAt?.toISOString() ?? null,
    });
    const item = catalog.find((c) => c.id === offer.itemId);
    if (item && (item.action === "quote" || item.action === "book")) addAction(`${item.action}:${item.ref}`);
  };

  /**
   * Services and products the reply asked to show as cards (photo, name, price), in the order the
   * model named them, in the owner's own words. A text message can't show a card.
   */
  const shownItems: ReplyItem[] = [];
  const addItem = (ref: string) => {
    const item = catalog.find((c) => c.ref === ref);
    if (!item) {
      deps.log?.("card dropped", { botId: bot.id, ref });
      return;
    }
    if (input.channel === "sms" || shownItems.length >= MAX_ITEMS_PER_REPLY) return;
    if (shownItems.some((i) => i.id === item.id)) return;
    shownItems.push({
      id: item.id,
      kind: item.kind,
      name: item.name,
      description: item.description,
      priceText: item.priceText,
      assetId: item.assetId,
      action: item.action,
      ...(item.action === "book" && bookingUrl ? { href: bookingUrl } : {}),
    });
  };

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
  /** The auxiliary model's triage, when it runs alongside the answer (first EN/FR message). */
  let pendingTriage: Promise<Awaited<ReturnType<LLMGateway["complete"]>> | null> | null = null;
  /** How many model calls the answer took (more than one when tools were used). */
  let modelCalls = 0;
  const toolsUsed = new Set<string>();
  /** What the assistant said was missing from the business's information (null = nothing). */
  let gapTopic: string | null = null;
  /** Things tools did that add-ons hear about (e.g. a request the visitor left). */
  const toolEvents: AddonEvent[] = [];
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
      // 2. Search queries: rewrite follow-ups and translate other languages into EN/FR. The same
      // auxiliary call triages the message (scope guard, any language). When no rewrite is needed
      // it runs alongside the answer, so it never slows the first reply down.
      const analyze = () =>
        deps.gateway.complete("aux", {
          ...buildSearchQueryPrompt(textHistory, message || IMAGE_ONLY_TEXT),
          maxTokens: 2000,
          effort: "low",
          signal: input.signal,
        });
      let queries = message ? [message] : [];
      // English or French that isn't the business's main language (a French question to a business
      // whose information is in English): the answer waits for the queries in both languages, as
      // keyword search can't match across languages.
      const mainLanguage = bot.defaultLanguage.toLowerCase().split("-")[0];
      const otherLanguage = Boolean(message) && isEnOrFr(language) && language !== mainLanguage;
      // With search by meaning, that question finds the text through its vector (the model is
      // multilingual), so the answer doesn't wait 2–3 s for the translation: the auxiliary call
      // runs alongside, as for a question in the main language. Without a vector in time, it waits.
      const waitForVector = () =>
        withDeadline(vectorRequest!, deps.embeddingWaitMs ?? EMBEDDING_WAIT_MS, () =>
          deps.log?.("embedding late", {
            botId: bot.id,
            waitedMs: deps.embeddingWaitMs ?? EMBEDDING_WAIT_MS,
          }),
        );
      let vector: QueryVector | null | undefined;
      if (otherLanguage && !history.length && vectorRequest) vector = await waitForVector();
      if (history.length || (message && !isEnOrFr(language)) || (otherLanguage && !vector)) {
        const aux = await analyze();
        auxMeta = aux;
        queries = parseSearchQueries(aux.text, message || IMAGE_ONLY_TEXT).filter(
          (q) => q !== IMAGE_ONLY_TEXT,
        );
        if (applyModelTriage(aux.text) && urgency) yield { type: "urgent", level: urgency, phone };
      } else if (message) {
        pendingTriage = analyze().catch((error: unknown) => {
          deps.log?.("triage failed", { error: errorMessage(error) });
          return null;
        });
      }

      // 3. Retrieve business information.
      const embedding =
        vector !== undefined ? vector : vectorRequest && queries.length ? await waitForVector() : null;
      const { passages, photos } = queries.length
        ? await searchBotKnowledge(
            deps.db,
            input.tenantId,
            { botId: bot.id, queries, embedding },
            input.channel !== "sms",
          )
        : { passages: [], photos: [] };
      offeredPhotos = photos;
      citations = citationsFrom(passages);

      // 4. Stream the answer. Photo markers are taken out of the text; only photos offered in
      // this prompt can be shown. The model may stop to call tools (e.g. search again with other
      // words); their results are added to the conversation and it is asked again.
      const markers = new MarkerFilter();
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
      const calendar =
        setup.calendar && deps.integrations
          ? calendarAccess(
              { db: deps.db, integrations: deps.integrations, fetch: deps.integrationsFetch },
              { tenantId: input.tenantId, botId: bot.id, provider: setup.calendar.provider },
              {
                timeZone: profile?.timezone ?? DEFAULT_TIME_ZONE,
                hours: profile?.hours ?? null,
                ...bookingSettings(setup.calendar.config),
              },
            )
          : null;
      const tools = chatTools(bot, {
        calendar,
        leadFields: template.leadFields,
        serviceArea: Boolean(profile?.serviceTowns.length || profile?.servicePostalPrefixes.length),
        catalog: catalog.length > 0,
      });
      const request = {
        system: buildSystemBlocks({
          bot,
          profile,
          passages,
          photos: offeredPhotos,
          catalog,
          notices: setup.notices,
          offers: runningOffers.map((o) => ({
            ref: o.ref,
            title: o.title ?? o.text,
            text: o.text,
            until: o.endsAt ? lastDay(o.endsAt, profile?.timezone ?? DEFAULT_TIME_ZONE) : null,
            itemRef: catalog.find((c) => c.id === o.itemId)?.ref ?? null,
          })),
          triage: { urgency, advice },
          channel: input.channel,
          addons: addonPrompt(addons, addonCtx, addonLog),
          now: deps.now?.() ?? new Date(),
        }),
        tools: tools.map(toToolDefinition),
        maxTokens: 16000,
        effort: "low" as const,
        signal: input.signal,
      };
      const turn: ChatMessage[] = [...modelHistory, { role: "user", content: current }];
      let found = passages;
      const write = (text: string): ChatStreamEvent => {
        answer += text;
        return emit(text);
      };
      /**
       * Takes back what the model has written so far, with the markers in it; the chat clears the
       * reply and what the model writes next replaces it. Used when a model writes again after a
       * tool call (the later text knows the tool's result, and models often repeat themselves),
       * and when a provider reports that what it streamed wasn't the reply after all.
       */
      function* retract(): Generator<ChatStreamEvent> {
        answer = "";
        gapTopic = null;
        shownPhotos.length = 0;
        shownActions.length = 0;
        shownOffers.length = 0;
        shownItems.length = 0;
        yield { type: "reset" };
        if (notice) {
          yield { type: "text", text: notice };
          separator = "\n\n";
        }
      }
      /** An earlier round of this answer already wrote to the visitor. */
      let wroteEarlier = false;
      /**
       * The reply gave away the instructions or tools (see output-check.ts): it was taken back, and
       * the rest of the model's output is read (for its usage) but never shown.
       */
      let withheld = false;
      function* checkDisclosure(): Generator<ChatStreamEvent> {
        if (!withheld && revealsInstructions(answer)) {
          withheld = true;
          yield* retract();
        }
      }

      for (let round = 0; ; round++) {
        let meta: GatewayResultMeta | undefined;
        for await (const event of deps.gateway.stream("chat", { ...request, messages: turn })) {
          if (withheld) {
            if (event.type !== "text" && event.type !== "reset") meta = event;
          } else if (event.type === "text") {
            const { text, ids, gaps, actions, offers, items } = markers.push(event.text);
            if (wroteEarlier && text.trim()) {
              yield* retract();
              wroteEarlier = false;
            }
            choose(ids);
            for (const action of actions) addAction(action);
            for (const offer of offers) addOffer(offer);
            for (const item of items) addItem(item);
            gapTopic ??= gaps[0] ?? null;
            if (text) {
              yield write(text);
              yield* checkDisclosure();
            }
          } else if (event.type === "reset") {
            markers.flush();
            if (answer) yield* retract();
          } else {
            meta = event;
          }
        }
        const rest = markers.flush();
        if (rest && !withheld) {
          yield write(rest);
          yield* checkDisclosure();
        }
        if (!meta) break;
        modelCalls++;
        chatMeta = addMeta(chatMeta, meta);
        if (withheld) break;

        // Tools run only for a complete turn that asked for them, and only a few rounds per answer.
        const calls = toolCallsOf(meta.message);
        if (meta.stopReason !== "tool_use" || !meta.message || !calls.length || round >= MAX_TOOL_ROUNDS) {
          break;
        }
        const ran = await runToolCalls(
          tools,
          calls,
          {
            db: deps.db,
            tenantId: input.tenantId,
            botId: bot.id,
            conversationId,
            channel: input.channel,
            language,
            urgent: Boolean(urgency),
            catalog,
            // By text, the customer's own number is how the business reaches them.
            visitorPhone: input.channel === "sms" ? input.visitorId : undefined,
            embeddings: deps.embeddings,
            onEmbedding: countEmbedding,
            now: deps.now,
            signal: input.signal,
          },
          { lastRound: round === MAX_TOOL_ROUNDS - 1, log: deps.log },
        );
        for (const name of ran.used) toolsUsed.add(name);
        toolEvents.push(...ran.events);
        if (ran.passages.length) {
          found = mergePassages(found, ran.passages);
          citations = citationsFrom(found);
        }
        turn.push(meta.message, { role: "user", content: ran.results });
        wroteEarlier = Boolean(answer.trim());
      }
      if (withheld) {
        flags.withheld = true;
        yield write(WITHHELD_TEXT[lang2]);
        citations = [];
      }
      if (toolsUsed.size) flags.tools = [...toolsUsed];
      // The assistant marked this reply: the business's information didn't have the answer.
      if (gapTopic !== null) flags.unanswered = true;

      if (
        chatMeta?.stopReason === "refusal" ||
        (!answer.trim() && !shownPhotos.length && !shownItems.length)
      ) {
        shownPhotos.length = 0;
        shownItems.length = 0;
        flags.unanswered = undefined;
        flags.refused = chatMeta?.stopReason === "refusal" || undefined;
        const fallback = FALLBACK_TEXT[lang2]!;
        yield emit(answer ? `\n\n${fallback}` : fallback);
        answer = answer ? `${answer}\n\n${fallback}` : fallback;
        citations = [];
      }
    } catch (error) {
      if (input.signal?.aborted) return;
      deps.log?.("chat failed", { error: errorMessage(error), botId: bot.id });
      const busy = isCapacityError(error);
      flags.unanswered = undefined;
      if (busy) flags.busy = true;
      else flags.error = true;
      const text = (busy ? BUSY_TEXT : ERROR_TEXT)[lang2]!;
      if (!answer) yield emit(text);
      answer = answer || text;
      citations = [];
      shownPhotos.length = 0;
      shownItems.length = 0;
    }
  }
  // The auxiliary model's triage that ran alongside the answer.
  if (pendingTriage) {
    const aux = await pendingTriage;
    if (aux) {
      auxMeta = aux;
      if (applyModelTriage(aux.text) && urgency) yield { type: "urgent", level: urgency, phone };
    }
  }
  if (urgency) flags.urgency = urgency;
  if (advice && !urgency) flags.advice = true;
  // An urgent problem always gets a Call button, first.
  if (urgency && !flags.error && !flags.busy) {
    addAction("call");
    shownActions.sort((a, b) => (a.kind === "call" ? -1 : b.kind === "call" ? 1 : 0));
  }
  // Getting help comes before selling: no service button on an urgent problem or an advice request.
  if (urgency || advice) {
    for (let i = shownActions.length - 1; i >= 0; i--) if (shownActions[i]!.item) shownActions.splice(i, 1);
  }
  // The same goes for promotions.
  if (urgency || advice || flags.error || flags.busy) shownOffers.length = 0;
  if (shownOffers.length) flags.offers = [...shownOffers];
  // And for service and product cards.
  if (urgency || advice || flags.error || flags.busy) shownItems.length = 0;
  if (shownItems.length) flags.items = [...shownItems];
  // A card already carries its item's button: no second one under the reply.
  for (let i = shownActions.length - 1; i >= 0; i--) {
    const itemId = shownActions[i]!.item?.id;
    if (itemId && shownItems.some((card) => card.id === itemId)) shownActions.splice(i, 1);
  }
  if (flags.error || flags.busy) shownActions.length = 0;
  if (shownActions.length) flags.actions = [...shownActions];

  if (notice) answer = answer ? `${notice}\n\n${answer}` : notice;
  answer = answer.replace(/\n{3,}/g, "\n\n").trim();
  for (const image of shownPhotos) yield { type: "image", image };
  for (const item of shownItems) yield { type: "item", item };
  for (const offer of shownOffers) yield { type: "offer", offer };
  for (const action of shownActions) yield { type: "action", action };

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
    if (embeddingUsage.tokens && deps.embeddings) {
      await tx.insert(usageEvents).values({
        tenantId: input.tenantId,
        botId: bot.id,
        kind: "embedding",
        quantity: embeddingUsage.tokens,
        costMicros: embeddingUsage.costMicros,
        metadata: { model: deps.embeddings.model, task: "questions" },
      });
    }
    if (usage.length) {
      await tx.insert(usageEvents).values(
        usage.map(({ kind, meta }) => ({
          tenantId: input.tenantId,
          botId: bot.id,
          kind,
          quantity: meta.usage.inputTokens + meta.usage.outputTokens,
          costMicros: meta.costMicros,
          metadata: {
            provider: meta.provider,
            model: meta.model,
            ...meta.usage,
            ...(kind === "llm.chat" && modelCalls > 1 ? { modelCalls, tools: [...toolsUsed] } : {}),
          },
        })),
      );
    }

    // Add-on effects (e.g. notification emails) run later in the worker, queued with the answer.
    // Listed for the business to answer (not from the owner's own test chat).
    if (flags.unanswered && input.channel !== "playground") {
      await recordGap(tx, {
        tenantId: input.tenantId,
        botId: bot.id,
        conversationId,
        topic: gapTopic ?? "",
        question: message,
        language,
      });
    }

    // The owner's own test chat never notifies, whatever happened in it.
    const passedOn = toolEvents.some((event) => event.type === "request.created");
    const events = [
      ...chatEvents({ input, conversationId, isNew, message, answer, language, flags, passedOn }),
      ...(input.channel === "playground" ? [] : toolEvents),
    ];
    const effects = events.flatMap((event) => addonEffects(addons, event, addonCtx, addonLog));
    // Urgent requests are emailed by the platform right away, ahead of other jobs.
    const urgentAlerts = events.flatMap((event) =>
      event.type === "request.created" && event.urgent
        ? [
            newJob({
              tenantId: input.tenantId,
              type: JOB_TYPES.urgentAlert,
              priority: JOB_PRIORITY.urgent,
              payload: { botId: bot.id, leadId: event.leadId },
            }),
          ]
        : [],
    );
    // Push to the team's phones (PLAN §20): urgent ones ahead of everything else.
    const pushes = events.flatMap((event) =>
      event.type === "request.created"
        ? [
            newJob({
              tenantId: input.tenantId,
              type: JOB_TYPES.pushNotify,
              priority: event.urgent ? JOB_PRIORITY.urgent : JOB_PRIORITY.normal,
              payload: {
                event: event.urgent ? "request.urgent" : "request.new",
                botId: bot.id,
                leadId: event.leadId,
              },
            }),
          ]
        : [],
    );
    const queued = [
      ...urgentAlerts,
      ...pushes,
      ...effects.map(({ addonId, effect }) =>
        newJob({
          tenantId: input.tenantId,
          type: JOB_TYPES.addonEffect,
          payload: { botId: bot.id, addonId, effect },
        }),
      ),
    ];
    if (queued.length) await tx.insert(jobs).values(queued);
    // Insights (premium): this conversation is tagged once it goes quiet.
    await queueInsights(tx, { tenantId: input.tenantId, conversationId, channel: input.channel });
    // Statistics: a service's button or card went out under this answer (docs/SELL_AND_PROMOTE.md §3.3).
    const surface = itemStatSurface(input.channel);
    const shownItemIds = new Set([
      ...shownActions.flatMap((action) => (action.item ? [action.item.id] : [])),
      ...shownItems.map((item) => item.id),
    ]);
    if (surface) {
      for (const itemId of shownItemIds) {
        await countItemEvent(tx, {
          tenantId: input.tenantId,
          botId: bot.id,
          itemId,
          surface,
          event: "shown",
        });
      }
    }
    // The owner's phone, when they asked for requests by text (docs/PHONE_AND_SMS.md §8).
    for (const event of events) {
      if (event.type === "request.created") {
        await textOwnerAboutRequest(tx, { tenantId: input.tenantId, botId: bot.id, request: event });
      }
    }
    return row!.id;
  });

  yield { type: "done", messageId, citations, flags };
}
