import { bots, knowledgeSources, type Tx } from "@traiblazer/db";
import { enOrFr } from "@traiblazer/i18n";
import type { InterviewQuestion } from "@traiblazer/industry-packs";
import { and, eq, sql } from "drizzle-orm";
import { audit } from "./audit.js";
import { badRequest, notFound } from "./errors.js";
import { interviewFor } from "./interview-questions.js";

/**
 * The setup interview's answers: one knowledge source per assistant (text, `settings.interview`),
 * written by the portal's interview routes and by the owner's agent.
 */

const TITLE = { en: "Interview answers", fr: "Réponses à l'entrevue" } as const;
/** Questions and source titles exist in English and French; other languages read the English. */
const tier1 = (language: string): "en" | "fr" => enOrFr(language.split("-")[0]);

/** An answer as stored: lines trimmed, no blank lines (a blank line would split it from its question). */
export const tidyAnswer = (answer: string) =>
  answer
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

/**
 * The source's text: each answered question and its answer, in the questions' order, as one block
 * each. The question stays with the answer, so "Yes, behind the building" keeps its meaning.
 */
export function interviewText(
  questions: InterviewQuestion[],
  answers: Record<string, string>,
  language: "en" | "fr",
): string {
  return questions
    .filter((question) => answers[question.key])
    .map((question) => `${question.question[language]}\n${answers[question.key]}`)
    .join("\n\n");
}

export const findInterviewSource = (tx: Tx, botId: string) =>
  tx
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.botId, botId),
        eq(knowledgeSources.type, "text"),
        sql`${knowledgeSources.settings} ? 'interview'`,
      ),
    )
    .limit(1);

/** The questions for the assistant's industry and the saved answers to them (in the tenant's scope). */
export async function readInterview(tx: Tx, botId: string) {
  const [bot] = await tx.select({ pack: bots.pack }).from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) throw notFound("Assistant");
  const [source] = await findInterviewSource(tx, botId);
  const questions = await interviewFor(tx, bot.pack);
  // Answers to questions staff have since removed or turned off aren't shown (or counted).
  const saved = source?.settings.interview?.answers ?? {};
  return {
    questions,
    answers: Object.fromEntries(
      questions.flatMap((q) => (saved[q.key] ? [[q.key, saved[q.key]]] : [])),
    ) as Record<string, string>,
    sourceId: source?.id ?? null,
    updatedAt: source?.updatedAt ?? null,
  };
}

/**
 * Saves the answers (all of them: a question left out or empty is unanswered) as the assistant's
 * interview source. With every answer empty the source is removed. Runs in the tenant's scope;
 * when `queued`, the caller enqueues the source's sync after the transaction.
 */
export async function saveInterview(
  tx: Tx,
  input: {
    tenantId: string;
    botId: string;
    actorUserId: string;
    answers: Record<string, string>;
    /** Recorded in the audit entry (e.g. "agent"). */
    via?: string;
  },
): Promise<{ sourceId: string | null; answers: Record<string, string>; queued: boolean }> {
  const { tenantId, botId } = input;
  const [bot] = await tx.select().from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) throw notFound("Assistant");
  const questions = await interviewFor(tx, bot.pack);
  const known = new Set(questions.map((question) => question.key));
  const unknown = Object.keys(input.answers).filter((key) => !known.has(key));
  if (unknown.length) throw badRequest(`Unknown question: ${unknown.join(", ")}`);

  const answers = Object.fromEntries(
    questions.flatMap((question) => {
      const answer = tidyAnswer(input.answers[question.key] ?? "");
      return answer ? [[question.key, answer]] : [];
    }),
  );
  const language = tier1(bot.defaultLanguage);
  const content = interviewText(questions, answers, language);
  const [current] = await findInterviewSource(tx, botId);
  const via = input.via ? { via: input.via } : {};

  if (!content) {
    // Nothing answered: the assistant no longer has answers to use.
    if (current) await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, current.id));
    await audit(tx, {
      tenantId,
      actorUserId: input.actorUserId,
      action: "interview.cleared",
      targetType: "bot",
      targetId: botId,
      ...(input.via ? { metadata: via } : {}),
    });
    return { sourceId: null, answers, queued: false };
  }

  const values = {
    content,
    status: "pending" as const,
    error: null,
    settings: { interview: { answers } },
  };
  const [row] = current
    ? await tx
        .update(knowledgeSources)
        .set(values)
        .where(eq(knowledgeSources.id, current.id))
        .returning({ id: knowledgeSources.id })
    : await tx
        .insert(knowledgeSources)
        .values({ tenantId, botId, type: "text", title: TITLE[language], ...values })
        .returning({ id: knowledgeSources.id });
  await audit(tx, {
    tenantId,
    actorUserId: input.actorUserId,
    action: "interview.saved",
    targetType: "knowledge_source",
    targetId: row!.id,
    metadata: { answered: Object.keys(answers), ...via },
  });
  return { sourceId: row!.id, answers, queued: true };
}
