import { jobs, type OutboundMessageKind, outboundMessages, smsOptOuts, type Tx } from "@traiblazer/db";
import { smsSegments } from "@traiblazer/telephony";
import { and, eq } from "drizzle-orm";
import { JOB_TYPES } from "../jobs.js";

export async function optedOut(tx: Tx, botId: string, number: string): Promise<boolean> {
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
    /** Keep the text without sending it (evals: the reply is read, nothing goes out). */
    hold?: boolean;
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
  if (input.hold) return row!.id;
  await tx.insert(jobs).values({
    tenantId: input.tenantId,
    type: JOB_TYPES.messageSend,
    payload: { messageId: row!.id },
    // A reply the customer is waiting for goes ahead of crawls and embedding.
    priority: 5,
  });
  return row!.id;
}
