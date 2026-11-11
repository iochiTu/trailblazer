import { enqueueJob, JOB_TYPES } from "@traiblazer/core";
import { bots, knowledgeSources, withTenant } from "@traiblazer/db";
import { getInterview, type InterviewQuestion } from "@traiblazer/industry-packs";
import { interviewAnswersSchema } from "@traiblazer/shared";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string } };

const TITLE = { en: "Interview answers", fr: "Réponses à l'entrevue" } as const;
/** Questions and source titles exist in English and French; other languages read the English. */
const tier1 = (language: string): "en" | "fr" => (language.split("-")[0] === "fr" ? "fr" : "en");

/** An answer as stored: lines trimmed, no blank lines (a blank line would split it from its question). */
const tidy = (answer: string) =>
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

/**
 * Interview mode of the setup assistant: questions for a business without a website.
 *   GET /v1/tenants/:t/bots/:b/interview   the questions for its industry, and the saved answers
 *   PUT /v1/tenants/:t/bots/:b/interview   save the answers as a knowledge source (one per assistant)
 * The answers are indexed like pasted text; with every answer empty the source is removed.
 */
export async function interviewRoutes(app: FastifyInstance, { db }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots/:botId/interview";

  const findSource = (tx: Parameters<Parameters<typeof withTenant>[2]>[0], botId: string) =>
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

  app.get<BotParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    return withTenant(db, request.tenant!.id, async (tx) => {
      const [bot] = await tx.select({ pack: bots.pack }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      const [source] = await findSource(tx, botId);
      return {
        questions: getInterview(bot.pack),
        answers: source?.settings.interview?.answers ?? {},
        sourceId: source?.id ?? null,
        updatedAt: source?.updatedAt ?? null,
      };
    });
  });

  app.put<BotParams>(base, { preHandler: requireTenantRole(db, "editor") }, async (request) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    const input = interviewAnswersSchema.parse(request.body);
    const tenantId = request.tenant!.id;

    const result = await withTenant(db, tenantId, async (tx) => {
      const [bot] = await tx.select().from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      const questions = getInterview(bot.pack);
      const known = new Set(questions.map((question) => question.key));
      const unknown = Object.keys(input.answers).filter((key) => !known.has(key));
      if (unknown.length) throw badRequest(`Unknown question: ${unknown.join(", ")}`);

      const answers = Object.fromEntries(
        questions.flatMap((question) => {
          const answer = tidy(input.answers[question.key] ?? "");
          return answer ? [[question.key, answer]] : [];
        }),
      );
      const language = tier1(bot.defaultLanguage);
      const content = interviewText(questions, answers, language);
      const [current] = await findSource(tx, botId);

      if (!content) {
        // Nothing answered: the assistant no longer has answers to use.
        if (current) await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, current.id));
        await audit(tx, {
          tenantId,
          actorUserId: request.user!.id,
          action: "interview.cleared",
          targetType: "bot",
          targetId: botId,
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
        actorUserId: request.user!.id,
        action: "interview.saved",
        targetType: "knowledge_source",
        targetId: row!.id,
        metadata: { answered: Object.keys(answers) },
      });
      return { sourceId: row!.id, answers, queued: true };
    });

    if (result.queued && result.sourceId) {
      await enqueueJob(db, { tenantId, type: JOB_TYPES.sourceSync, payload: { sourceId: result.sourceId } });
    }
    return { sourceId: result.sourceId, answers: result.answers };
  });
}
