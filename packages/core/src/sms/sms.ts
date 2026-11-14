import {
  bots,
  businessProfiles,
  conversations,
  type Db,
  type MessageFlags,
  messages,
  outboundMessages,
  type ReplyAction,
  smsOptOuts,
  type Tx,
  usageEvents,
  withTenant,
} from "@traiblazer/db";
import {
  type MessageStatusUpdate,
  PermanentSendError,
  smsKeyword,
  smsReplyWord,
  type TelephonyProvider,
  toSmsText,
} from "@traiblazer/telephony";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { type ChatDeps, type ChatImage, runChat } from "../chat/engine.js";
import { guessLanguage } from "../chat/language.js";
import { noteCapReached, phoneBudget } from "./alerts.js";
import { optedOut, queueText } from "./queue.js";
import { smsLanguage, smsText } from "./strings.js";

/** A text after this long without one starts a new conversation: an old topic doesn't colour a new question. */
export const SMS_THREAD_HOURS = 24;
/** Most texts one number gets answered in 24 hours (abuse and cost). */
export const SMS_DAILY_LIMIT = 40;

/** The assistant's number an event arrived on, as `resolvePhoneNumber` found it. */
export interface SmsNumber {
  tenantId: string;
  botId: string;
  /** Our number, E.164. */
  e164: string;
}

const hoursAgo = (now: Date, hours: number) => new Date(now.getTime() - hours * 3600_000);

async function business(tx: Tx, botId: string) {
  const [row] = await tx
    .select({
      status: bots.status,
      name: bots.name,
      defaultLanguage: bots.defaultLanguage,
      businessName: businessProfiles.businessName,
      phone: businessProfiles.phone,
    })
    .from(bots)
    .leftJoin(businessProfiles, eq(businessProfiles.botId, bots.id))
    .where(eq(bots.id, botId))
    .limit(1);
  if (!row) return null;
  return {
    paused: row.status === "paused",
    name: row.businessName?.trim() || row.name,
    phone: row.phone?.trim() || null,
    language: smsLanguage(row.defaultLanguage),
  };
}

export type InboundTextOutcome =
  | "answered"
  | "stopped"
  | "resumed"
  | "help"
  | "opted_out"
  | "limited"
  | "capped"
  | "owner"
  | "unavailable"
  | "failed";

/**
 * A text from a customer to an assistant's number: STOP, START and HELP are handled first, then the
 * assistant answers in the customer's thread (channel "sms") and the reply is queued.
 */
export async function handleInboundText(
  deps: ChatDeps & {
    /** Keep the texts it writes without sending them (evals). */
    holdTexts?: boolean;
  },
  number: SmsNumber,
  message: {
    from: string;
    text: string;
    /** Photos sent with it (MMS), already checked and cleaned by the API. */
    images?: ChatImage[];
    /** Something was attached that couldn't be used (a video, a file too large). */
    hasMedia?: boolean;
  },
): Promise<InboundTextOutcome> {
  const now = deps.now?.() ?? new Date();
  const scope = { tenantId: number.tenantId, botId: number.botId };
  const keyword = smsKeyword(message.text);

  const before = await withTenant(deps.db, number.tenantId, async (tx) => {
    const info = await business(tx, number.botId);
    if (!info || info.paused) return { outcome: "unavailable" as const };
    const system = (body: string) =>
      queueText(tx, {
        ...scope,
        hold: deps.holdTexts,
        kind: "system",
        from: number.e164,
        to: message.from,
        body,
      });
    // The words the customer used tell the language, when there are enough of them.
    const guessed = guessLanguage(message.text);
    const language = guessed === "fr" || guessed === "en" ? guessed : info.language;
    const t = smsText(language);

    if (keyword === "stop") {
      await tx
        .insert(smsOptOuts)
        .values({ ...scope, number: message.from })
        .onConflictDoNothing();
      // The carrier confirms a STOP itself; anything from us would be one message too many.
      return { outcome: "stopped" as const };
    }
    if (keyword === "start") {
      await tx
        .delete(smsOptOuts)
        .where(and(eq(smsOptOuts.botId, number.botId), eq(smsOptOuts.number, message.from)));
      await system(smsText(info.language).resumed(info.name));
      return { outcome: "resumed" as const };
    }
    if (await optedOut(tx, number.botId, message.from)) return { outcome: "opted_out" as const };
    if (keyword === "help") {
      await system(smsText(info.language).help(info.name, info.phone));
      return { outcome: "help" as const };
    }

    const budget = await phoneBudget(tx, number.botId, now);
    // The owner answering one of our alerts isn't a customer: nothing to answer.
    if (budget?.number.alertNumber === message.from) return { outcome: "owner" as const };
    // The daily spend cap: no answer (it would cost), and the business is told once.
    if (budget?.capped) {
      await noteCapReached(tx, budget, now);
      return { outcome: "capped" as const };
    }

    // How much this number has written today, across its threads.
    const [used] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(conversations.botId, number.botId),
          eq(conversations.channel, "sms"),
          eq(conversations.visitorId, message.from),
          eq(messages.role, "user"),
          gte(messages.createdAt, hoursAgo(now, 24)),
        ),
      );
    if ((used?.n ?? 0) >= SMS_DAILY_LIMIT) {
      // Said once, when the limit is reached; silence after that.
      if (used!.n === SMS_DAILY_LIMIT) await system(t.limit(info.phone));
      return { outcome: "limited" as const, count: used!.n };
    }

    const [thread] = await tx
      .select({ id: conversations.id, language: conversations.language })
      .from(conversations)
      .where(
        and(
          eq(conversations.botId, number.botId),
          eq(conversations.channel, "sms"),
          eq(conversations.visitorId, message.from),
          gte(conversations.lastMessageAt, hoursAgo(now, SMS_THREAD_HOURS)),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);

    // "QUOTE" or "BOOK" takes up the offer made for a service earlier in the thread.
    const word = smsReplyWord(message.text);
    let offer: { kind: "quote" | "book"; name: string } | null = null;
    if (word && thread) {
      const recent = await tx
        .select({ flags: messages.flags })
        .from(messages)
        .where(and(eq(messages.conversationId, thread.id), eq(messages.role, "assistant")))
        .orderBy(desc(messages.createdAt))
        .limit(6);
      const item = recent
        .flatMap((m) => (m.flags as MessageFlags | null)?.actions ?? [])
        .find((a) => a.item && a.kind === word && !a.href)?.item;
      if (item) offer = { kind: word, name: item.name };
    }
    // A single word doesn't tell the language: the thread's own language does.
    const spoken =
      !word && (guessed === "fr" || guessed === "en")
        ? guessed
        : smsLanguage(thread?.language ?? info.language);
    return { outcome: null, info, t: smsText(spoken), conversationId: thread?.id ?? null, offer };
  });
  if (before.outcome) {
    // The message at the limit is still stored, so the count moves past it and the notice isn't repeated.
    // At the cap the customer's text is kept too, so the business can read it in Conversations.
    if (before.outcome === "limited" || before.outcome === "capped") {
      await storeUnanswered(deps.db, number, message.from, message.text, now);
    }
    return before.outcome;
  }
  const { info, t } = before;

  const images = message.images ?? [];
  // Nothing to answer: no words, and no photo that could be opened.
  if (!message.text.trim() && !images.length) {
    await withTenant(deps.db, number.tenantId, (tx) =>
      queueText(tx, {
        ...scope,
        hold: deps.holdTexts,
        kind: "system",
        from: number.e164,
        to: message.from,
        body: t.nothingToRead,
      }),
    );
    return "answered";
  }

  let conversationId = before.conversationId;
  let reply = "";
  let failed = false;
  let actions: ReplyAction[] = [];
  // The reply word stands for the sentence a tap on the service's button sends in the chat.
  const said = before.offer
    ? before.offer.kind === "quote"
      ? t.quoteMessage(before.offer.name)
      : t.bookMessage(before.offer.name)
    : message.text.slice(0, 2000);
  try {
    for await (const event of runChat(deps, {
      ...scope,
      conversationId,
      visitorId: message.from,
      channel: "sms",
      message: said,
      images,
    })) {
      if (event.type === "start") conversationId = event.conversationId;
      else if (event.type === "text") reply += event.text;
      else if (event.type === "reset") reply = "";
      else if (event.type === "error") failed = true;
      else if (event.type === "done") {
        if (event.flags.error || event.flags.busy) failed = true;
        actions = event.flags.actions ?? [];
      }
    }
  } catch (error) {
    failed = true;
    deps.log?.("sms answer failed", { error: error instanceof Error ? error.message : String(error) });
  }

  // A service's button becomes a line saying what to reply (or the booking link, when there is one).
  const offers = actions.flatMap((a) =>
    !a.item
      ? []
      : a.kind === "quote"
        ? [t.replyQuote(a.item.name)]
        : a.href
          ? [t.bookLink(a.item.name, a.href)]
          : [t.replyBook(a.item.name)],
  );
  const body = !failed && reply.trim() ? [toSmsText(reply), ...offers].join("\n") : t.failed(info.phone);
  await withTenant(deps.db, number.tenantId, (tx) =>
    queueText(tx, {
      ...scope,
      hold: deps.holdTexts,
      conversationId,
      kind: "reply",
      from: number.e164,
      to: message.from,
      body,
    }),
  );
  return failed || !reply.trim() ? "failed" : "answered";
}

/** Keeps a text that got no answer (a limit was reached) in the customer's thread. */
async function storeUnanswered(db: Db, number: SmsNumber, from: string, text: string, now: Date) {
  await withTenant(db, number.tenantId, async (tx) => {
    let [thread] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.botId, number.botId),
          eq(conversations.channel, "sms"),
          eq(conversations.visitorId, from),
          gte(conversations.lastMessageAt, hoursAgo(now, SMS_THREAD_HOURS)),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    if (!thread) {
      [thread] = await tx
        .insert(conversations)
        .values({
          tenantId: number.tenantId,
          botId: number.botId,
          channel: "sms",
          visitorId: from,
          language: guessLanguage(text),
          lastMessageAt: now,
        })
        .returning({ id: conversations.id });
    }
    if (!thread) return;
    await tx.insert(messages).values({
      tenantId: number.tenantId,
      conversationId: thread.id,
      role: "user",
      content: text.slice(0, 2000),
    });
    await tx
      .update(conversations)
      .set({ messageCount: sql`${conversations.messageCount} + 1`, lastMessageAt: now })
      .where(eq(conversations.id, thread.id));
  });
}

export interface MissedCallResult {
  /** What the caller hears before the call ends. */
  say: string;
  language: "en" | "fr";
  /** Whether a text was queued ("no": withheld number, opted out, already texted today, paused). */
  texted: boolean;
}

/**
 * A call to an assistant's number in "text back" mode: the caller hears one sentence, and gets one
 * text (at most one a day) that opens an SMS conversation with the assistant.
 */
export async function handleMissedCall(
  deps: Pick<ChatDeps, "db" | "now">,
  number: SmsNumber,
  call: { from: string | null },
): Promise<MissedCallResult | null> {
  const now = deps.now?.() ?? new Date();
  return withTenant(deps.db, number.tenantId, async (tx) => {
    const info = await business(tx, number.botId);
    if (!info || info.paused) return null;
    const t = smsText(info.language);
    const noText = { say: t.callAnswerNoText(info.name), language: info.language, texted: false };
    if (!call.from || (await optedOut(tx, number.botId, call.from))) return noText;
    // At the daily spend cap nothing more is sent; the business is told once.
    const budget = await phoneBudget(tx, number.botId, now);
    if (budget?.capped) {
      await noteCapReached(tx, budget, now);
      return noText;
    }

    const [recent] = await tx
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.botId, number.botId),
          eq(outboundMessages.toNumber, call.from),
          eq(outboundMessages.kind, "text_back"),
          gte(outboundMessages.createdAt, hoursAgo(now, 24)),
        ),
      )
      .limit(1);
    // Already texted today: the caller has the thread, and a second text would nag.
    if (recent) return { say: t.callAnswer(info.name), language: info.language, texted: false };

    // The text opens the conversation, so the customer's reply continues it.
    const body = t.textBack(info.name);
    const [conversation] = await tx
      .insert(conversations)
      .values({
        tenantId: number.tenantId,
        botId: number.botId,
        channel: "sms",
        visitorId: call.from,
        language: info.language,
        messageCount: 1,
        lastMessageAt: now,
      })
      .returning({ id: conversations.id });
    await tx.insert(messages).values({
      tenantId: number.tenantId,
      conversationId: conversation!.id,
      role: "assistant",
      content: body,
      language: info.language,
    });
    await queueText(tx, {
      tenantId: number.tenantId,
      botId: number.botId,
      conversationId: conversation!.id,
      kind: "text_back",
      from: number.e164,
      to: call.from,
      body,
    });
    return { say: t.callAnswer(info.name), language: info.language, texted: true };
  });
}

export interface SendDeps {
  db: Db;
  telephony: TelephonyProvider;
  /** Where the provider reports delivery of a message, or nothing to skip delivery reports. */
  statusCallbackUrl?: (tenantId: string, messageId: string) => string;
  /** What one message part costs us, in millionths of a dollar (for usage records). */
  segmentCostMicros?: number;
}

/**
 * Sends one queued text (job `message.send`). A refusal that won't change (bad number, opted out at
 * the carrier) marks it failed; anything else throws, so the job is tried again.
 */
export async function sendQueuedText(
  deps: SendDeps,
  tenantId: string,
  messageId: string,
): Promise<"sent" | "skipped" | "failed"> {
  const message = await withTenant(deps.db, tenantId, async (tx) => {
    const [row] = await tx.select().from(outboundMessages).where(eq(outboundMessages.id, messageId)).limit(1);
    if (row?.status !== "queued" || row.providerId) return null;
    // Opted out between queuing and sending.
    if (await optedOut(tx, row.botId, row.toNumber)) {
      await tx
        .update(outboundMessages)
        .set({ status: "failed", error: "opted_out" })
        .where(eq(outboundMessages.id, row.id));
      return null;
    }
    return row;
  });
  if (!message) return "skipped";

  try {
    const sent = await deps.telephony.sendMessage({
      from: message.fromNumber,
      to: message.toNumber,
      text: message.body,
      statusCallbackUrl: deps.statusCallbackUrl?.(tenantId, message.id),
    });
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx
        .update(outboundMessages)
        .set({ status: sent.status === "queued" ? "sent" : sent.status, providerId: sent.id })
        .where(eq(outboundMessages.id, message.id));
      await tx.insert(usageEvents).values({
        tenantId,
        botId: message.botId,
        kind: "sms",
        quantity: message.segments,
        costMicros: message.segments * (deps.segmentCostMicros ?? 0),
        metadata: { provider: deps.telephony.id, kind: message.kind },
      });
    });
    return "sent";
  } catch (error) {
    if (!(error instanceof PermanentSendError)) throw error;
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx
        .update(outboundMessages)
        .set({ status: "failed", error: error.code ?? error.message.slice(0, 200) })
        .where(eq(outboundMessages.id, message.id));
      // The carrier says this number opted out (Twilio 21610): remember it, so we stop trying.
      if (error.code === "21610") {
        await tx
          .insert(smsOptOuts)
          .values({ tenantId, botId: message.botId, number: message.toNumber })
          .onConflictDoNothing();
      }
    });
    return "failed";
  }
}

/** A delivery report from the provider. A delivered message stays delivered. */
export async function applyMessageStatus(
  db: Db,
  tenantId: string,
  messageId: string,
  update: MessageStatusUpdate,
): Promise<boolean> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: outboundMessages.status, providerId: outboundMessages.providerId })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, messageId))
      .limit(1);
    if (!row || row.providerId !== update.id) return false;
    if (row.status === "delivered" || update.status === "queued") return true;
    await tx
      .update(outboundMessages)
      .set({
        status: update.status,
        error: update.status === "failed" ? (update.errorCode ?? "failed") : null,
      })
      .where(eq(outboundMessages.id, messageId));
    return true;
  });
}

export { queueText } from "./queue.js";
