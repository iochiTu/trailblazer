import {
  bots,
  businessProfiles,
  conversations,
  type Db,
  jobs,
  messages,
  type OutboundMessageKind,
  outboundMessages,
  smsOptOuts,
  type Tx,
  usageEvents,
  withTenant,
} from "@traiblazer/db";
import {
  type MessageStatusUpdate,
  PermanentSendError,
  smsKeyword,
  smsSegments,
  type TelephonyProvider,
  toSmsText,
} from "@traiblazer/telephony";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { type ChatDeps, runChat } from "../chat/engine.js";
import { guessLanguage } from "../chat/language.js";
import { JOB_TYPES } from "../jobs.js";
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

async function optedOut(tx: Tx, botId: string, number: string): Promise<boolean> {
  const rows = await tx
    .select({ number: smsOptOuts.number })
    .from(smsOptOuts)
    .where(and(eq(smsOptOuts.botId, botId), eq(smsOptOuts.number, number)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Queues a text for the worker to send (job `message.send`), in the caller's transaction. Returns
 * null, queuing nothing, when the number has opted out.
 */
export async function queueText(
  tx: Tx,
  input: {
    tenantId: string;
    botId: string;
    conversationId?: string | null;
    kind: OutboundMessageKind;
    from: string;
    to: string;
    body: string;
  },
): Promise<string | null> {
  if (await optedOut(tx, input.botId, input.to)) return null;
  const [row] = await tx
    .insert(outboundMessages)
    .values({
      tenantId: input.tenantId,
      botId: input.botId,
      conversationId: input.conversationId ?? null,
      kind: input.kind,
      fromNumber: input.from,
      toNumber: input.to,
      body: input.body,
      segments: smsSegments(input.body),
    })
    .returning({ id: outboundMessages.id });
  await tx.insert(jobs).values({
    tenantId: input.tenantId,
    type: JOB_TYPES.messageSend,
    payload: { messageId: row!.id },
    // A reply the customer is waiting for goes ahead of crawls and embedding.
    priority: 5,
  });
  return row!.id;
}

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
  | "unavailable"
  | "failed";

/**
 * A text from a customer to an assistant's number: STOP, START and HELP are handled first, then the
 * assistant answers in the customer's thread (channel "sms") and the reply is queued.
 */
export async function handleInboundText(
  deps: ChatDeps,
  number: SmsNumber,
  message: { from: string; text: string; hasMedia?: boolean },
): Promise<InboundTextOutcome> {
  const now = deps.now?.() ?? new Date();
  const scope = { tenantId: number.tenantId, botId: number.botId };
  const keyword = smsKeyword(message.text);

  const before = await withTenant(deps.db, number.tenantId, async (tx) => {
    const info = await business(tx, number.botId);
    if (!info || info.paused) return { outcome: "unavailable" as const };
    const system = (body: string) =>
      queueText(tx, { ...scope, kind: "system", from: number.e164, to: message.from, body });
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
      .select({ id: conversations.id })
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
    return { outcome: null, info, t, conversationId: thread?.id ?? null };
  });
  if (before.outcome) {
    // The message at the limit is still stored, so the count moves past it and the notice isn't repeated.
    if (before.outcome === "limited") await storeUnanswered(deps.db, number, message.from, message.text, now);
    return before.outcome;
  }
  const { info, t } = before;

  // Photos by text aren't read yet: say so when there are no words to answer.
  if (!message.text.trim()) {
    await withTenant(deps.db, number.tenantId, (tx) =>
      queueText(tx, { ...scope, kind: "system", from: number.e164, to: message.from, body: t.textOnly }),
    );
    return "answered";
  }

  let conversationId = before.conversationId;
  let reply = "";
  let failed = false;
  try {
    for await (const event of runChat(deps, {
      ...scope,
      conversationId,
      visitorId: message.from,
      channel: "sms",
      message: message.text.slice(0, 2000),
    })) {
      if (event.type === "start") conversationId = event.conversationId;
      else if (event.type === "text") reply += event.text;
      else if (event.type === "reset") reply = "";
      else if (event.type === "error") failed = true;
      else if (event.type === "done" && (event.flags.error || event.flags.busy)) failed = true;
    }
  } catch (error) {
    failed = true;
    deps.log?.("sms answer failed", { error: error instanceof Error ? error.message : String(error) });
  }

  const body = !failed && reply.trim() ? toSmsText(reply) : t.failed(info.phone);
  await withTenant(deps.db, number.tenantId, (tx) =>
    queueText(tx, { ...scope, conversationId, kind: "reply", from: number.e164, to: message.from, body }),
  );
  return failed || !reply.trim() ? "failed" : "answered";
}

/** Keeps a text that got no answer (over the daily limit) in the customer's latest thread. */
async function storeUnanswered(db: Db, number: SmsNumber, from: string, text: string, now: Date) {
  await withTenant(db, number.tenantId, async (tx) => {
    const [thread] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.botId, number.botId),
          eq(conversations.channel, "sms"),
          eq(conversations.visitorId, from),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
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
