import { createHash } from "node:crypto";
import { type Db, inboundSms, jobs, resolvePhoneNumber, withTenant } from "@traiblazer/db";
import { MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGES } from "@traiblazer/shared";
import { type InboundMessage, smsKeyword, type TelephonyProvider } from "@traiblazer/telephony";
import { eq } from "drizzle-orm";
import { admitImages, admitQuestion } from "../admission/chat-guard.js";
import type { Limiter } from "../admission/limiter.js";
import type { PlatformConfig } from "../admission/platform.js";
import type { ChatDeps, ChatImage } from "../chat/engine.js";
import { prepareChatImage } from "../chat/images.js";
import { JOB_TYPES, newJob } from "../jobs.js";
import { optedOut } from "./queue.js";
import { handleInboundText, handleSmsKeyword } from "./sms.js";

export async function receiveSms(
  db: Db,
  provider: string,
  number: { tenantId: string; botId: string; smsEnabled: boolean },
  message: InboundMessage,
) {
  const keyword = smsKeyword(message.text);
  if (!keyword && !number.smsEnabled) return;
  await withTenant(db, number.tenantId, async (tx) => {
    const [receipt] = await tx
      .insert(inboundSms)
      .values({
        tenantId: number.tenantId,
        botId: number.botId,
        provider,
        providerId: message.id,
        message: keyword
          ? null
          : {
              from: message.from,
              to: message.to,
              text: message.text,
              media: message.media.slice(0, MAX_CHAT_IMAGES),
            },
      })
      .onConflictDoNothing()
      .returning({ id: inboundSms.id });
    if (!receipt) return;
    if (keyword) {
      await handleSmsKeyword(tx, { ...number, e164: message.to }, message.from, keyword);
    } else {
      await tx.insert(jobs).values(
        newJob({
          tenantId: number.tenantId,
          type: JOB_TYPES.messageReceive,
          payload: { receiptId: receipt.id },
          priority: 5,
        }),
      );
    }
  });
}

/** The receipt lock serializes retries. The reply, its send job and clearing the payload commit together. */
export async function processInboundSms(
  deps: ChatDeps & { telephony: TelephonyProvider; limiter: Limiter; platform: PlatformConfig },
  tenantId: string,
  receiptId: string,
) {
  let release: (() => Promise<void>) | undefined;
  try {
    // Commit the quota reservation before waiting for media or the model. Other conversations
    // must be able to update the same business's monthly counter while the worker is answering.
    const accepted = await withTenant(deps.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(inboundSms).where(eq(inboundSms.id, receiptId)).for("update");
      if (!row?.message) return false;
      if (row.provider !== deps.telephony.id) throw new Error("SMS provider unavailable for queued message");
      const number = await resolvePhoneNumber(tx, row.message.to);
      if (
        !number?.smsEnabled ||
        number.botId !== row.botId ||
        number.tenantId !== tenantId ||
        (await optedOut(tx, row.botId, row.message.from))
      ) {
        await tx.update(inboundSms).set({ message: null }).where(eq(inboundSms.id, receiptId));
        return false;
      }
      const admission = await admitQuestion(
        {
          db: tx,
          platform: deps.platform,
          limiter: deps.limiter,
          maxConversationQuestions: Number.MAX_SAFE_INTEGER,
          alreadyCounted: row.message.admitted,
        },
        { tenantId, visitorId: row.message.from, conversationId: null },
      );
      if (!admission.ok) {
        if (admission.reason === "busy") throw new Error("SMS processing capacity is busy");
        await tx.update(inboundSms).set({ message: null }).where(eq(inboundSms.id, receiptId));
        return false;
      }
      release = admission.release;
      if (!row.message.admitted)
        await tx
          .update(inboundSms)
          .set({ message: { ...row.message, admitted: true } })
          .where(eq(inboundSms.id, receiptId));
      return true;
    });
    if (!accepted) return;
    await withTenant(deps.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(inboundSms).where(eq(inboundSms.id, receiptId)).for("update");
      if (!row?.message) return;
      const message = row.message;
      const finish = () => tx.update(inboundSms).set({ message: null }).where(eq(inboundSms.id, receiptId));
      const number = await resolvePhoneNumber(tx, message.to);
      if (!number?.smsEnabled || number.botId !== row.botId || number.tenantId !== tenantId) {
        await finish();
        return;
      }
      const images: ChatImage[] = [];
      for (const media of message.media.slice(0, MAX_CHAT_IMAGES)) {
        const file = await deps.telephony.fetchMedia(media.url, MAX_CHAT_IMAGE_BYTES);
        const prepared = file && prepareChatImage(file.bytes.toString("base64"), MAX_CHAT_IMAGE_BYTES);
        if (!prepared?.ok) continue;
        images.push({
          name: `photo-${images.length + 1}.${prepared.contentType.split("/")[1]}`,
          contentType: prepared.contentType,
          dataBase64: prepared.bytes.toString("base64"),
          sizeBytes: prepared.bytes.length,
          sha256: createHash("sha256").update(prepared.bytes).digest("hex"),
        });
      }

      const allowed =
        !images.length ||
        (await admitImages(deps.limiter, { tenantId, visitorId: message.from, count: images.length }));
      await handleInboundText(
        { ...deps, db: tx },
        { tenantId, botId: row.botId, e164: message.to },
        {
          from: message.from,
          text: message.text,
          images: allowed ? images : [],
          hasMedia: message.media.length > 0,
        },
      );
      await finish();
    });
  } finally {
    await release?.();
  }
}
