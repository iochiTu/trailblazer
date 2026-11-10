import { knowledgeGaps, type Tx } from "@traiblazer/db";
import { eq, sql } from "drizzle-orm";

/**
 * How alike two topics must be (trigram similarity, 0–1) to count as the same gap. Set so that
 * rewordings merge ("wedding cake prices" / "prices for wedding cakes": 0.76) but neighbours don't
 * ("bike parking" / "car parking": 0.47): two lines for one question cost the business a click,
 * while one line for two questions hides the second.
 */
const SAME_TOPIC = 0.55;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * Records a question the assistant couldn't answer. A gap the business hasn't dealt with yet
 * (or dismissed) that is about the same thing is counted again instead of listed twice; a dismissed
 * one stays dismissed. An answered gap asked about again is listed anew: the answer isn't working.
 * Must run inside withTenant().
 */
export async function recordGap(
  tx: Tx,
  input: {
    tenantId: string;
    botId: string;
    conversationId: string;
    /** What was missing, as named by the assistant; falls back to the visitor's question. */
    topic: string;
    question: string;
    language: string | null;
  },
): Promise<{ id: string; isNew: boolean } | null> {
  const question = clip(input.question, 500);
  const topic = clip(input.topic, 200) || clip(question, 200);
  if (!topic) return null;

  const [match] = await tx.execute<{ id: string }>(sql`
    select id from knowledge_gaps
     where bot_id = ${input.botId} and status in ('open', 'dismissed')
       and similarity(lower(topic), lower(${topic})) >= ${SAME_TOPIC}
     order by similarity(lower(topic), lower(${topic})) desc
     limit 1`);
  if (match) {
    await tx
      .update(knowledgeGaps)
      .set({
        occurrences: sql`${knowledgeGaps.occurrences} + 1`,
        lastAskedAt: new Date(),
        ...(question ? { question, language: input.language, conversationId: input.conversationId } : {}),
      })
      .where(eq(knowledgeGaps.id, match.id));
    return { id: match.id, isNew: false };
  }

  const [gap] = await tx
    .insert(knowledgeGaps)
    .values({
      tenantId: input.tenantId,
      botId: input.botId,
      conversationId: input.conversationId,
      topic,
      question: question || topic,
      language: input.language,
    })
    .returning({ id: knowledgeGaps.id });
  return { id: gap!.id, isNew: true };
}
