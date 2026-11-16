import { onboardingQuestions, operatorAuditLogs } from "@traiblazer/db";
import { getStandardQuestion, INTERVIEW_LIMITS, packs, STANDARD_QUESTIONS } from "@traiblazer/industry-packs";
import {
  createOnboardingQuestionSchema,
  onboardingQuestionProblem,
  updateOnboardingQuestionSchema,
} from "@traiblazer/shared";
import { count, eq, max } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { type QuestionRow, questionSet } from "../lib/interview-questions.js";
import { requireSuperAdmin } from "../plugins/auth.js";

type IdParams = { Params: { id: string } };

const orderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(INTERVIEW_LIMITS.questions) });

const KNOWN_PACKS = new Set(packs.map((p) => p.slug));

/** Fields compared with the standard wording. */
const WORDING = ["packs", "kind", "question", "hint", "options"] as const;

/** A question as the console shows it: whether it is a standard one, and changed from it. */
const present = (row: QuestionRow) => {
  const standard = getStandardQuestion(row.key);
  return {
    ...row,
    standard: Boolean(standard),
    modified: standard
      ? WORDING.some((field) => JSON.stringify(row[field]) !== JSON.stringify(standard[field]))
      : false,
  };
};

/**
 * The setup interview's question set (operator console, super admins only). The onboarding chat and
 * the Knowledge tab's interview ask a business the enabled questions for its industry, in order.
 *   GET    /v1/operator/onboarding-questions              the set, and the industries to choose from
 *   POST   /v1/operator/onboarding-questions              add a question
 *   PATCH  /v1/operator/onboarding-questions/:id          change one (its key stays)
 *   POST   /v1/operator/onboarding-questions/:id/reset    back to the standard wording
 *   POST   /v1/operator/onboarding-questions/order        reorder the whole set
 *   POST   /v1/operator/onboarding-questions/restore      add back removed standard questions
 *   DELETE /v1/operator/onboarding-questions/:id          remove one
 * Every change is written to the operator audit log. Answers businesses already saved stay in
 * their knowledge source until they next save their interview.
 */
export async function onboardingQuestionRoutes(app: FastifyInstance, { db }: AppContext) {
  const guard = { preHandler: requireSuperAdmin };
  const base = "/v1/operator/onboarding-questions";

  const log = (request: FastifyRequest, action: string, targetId: string, metadata: object = {}) =>
    db.insert(operatorAuditLogs).values({
      actorUserId: request.user!.id,
      action,
      targetType: "onboarding_question",
      targetId,
      metadata: metadata as Record<string, unknown>,
    });

  const find = async (id: string) => {
    if (!isUuid(id)) throw notFound("Question");
    const [row] = await db.select().from(onboardingQuestions).where(eq(onboardingQuestions.id, id)).limit(1);
    if (!row) throw notFound("Question");
    return row;
  };

  const checkPacks = (list: string[] | undefined) => {
    const unknown = (list ?? []).filter((slug) => !KNOWN_PACKS.has(slug));
    if (unknown.length) throw badRequest(`Unknown industry: ${unknown.join(", ")}`);
  };

  const check = (question: Parameters<typeof onboardingQuestionProblem>[0]) => {
    const problem = onboardingQuestionProblem(question);
    if (problem) throw badRequest(problem);
  };

  app.get(base, guard, async () => ({
    questions: (await questionSet(db)).map(present),
    packs: packs.map(({ slug, name, phase }) => ({ slug, name, phase })),
  }));

  app.post(base, guard, async (request, reply) => {
    const input = createOnboardingQuestionSchema.parse(request.body);
    checkPacks(input.packs);
    check(input);
    const [existing] = await db
      .select({ id: onboardingQuestions.id })
      .from(onboardingQuestions)
      .where(eq(onboardingQuestions.key, input.key))
      .limit(1);
    if (existing) throw conflict(`A question with the key "${input.key}" already exists`);
    const [stats] = await db
      .select({ n: count(), last: max(onboardingQuestions.sortOrder) })
      .from(onboardingQuestions);
    if ((stats?.n ?? 0) >= INTERVIEW_LIMITS.questions) {
      throw badRequest(`The set can have up to ${INTERVIEW_LIMITS.questions} questions`);
    }
    const [created] = await db
      .insert(onboardingQuestions)
      .values({
        ...input,
        sortOrder: input.sortOrder ?? (stats?.last ?? 0) + 10,
        updatedBy: request.user!.id,
      })
      .returning();
    await log(request, "onboarding_question.created", created!.id, { key: created!.key });
    return reply.code(201).send({ question: present(created!) });
  });

  app.patch<IdParams>(`${base}/:id`, guard, async (request) => {
    const before = await find(request.params.id);
    const input = updateOnboardingQuestionSchema.parse(request.body);
    checkPacks(input.packs);
    // Turning a question into a short or long one drops its quick answers.
    const merged = { ...before, ...input };
    if (input.kind && input.kind !== "choice" && input.options === undefined) merged.options = [];
    check(merged);
    const [updated] = await db
      .update(onboardingQuestions)
      .set({
        packs: merged.packs,
        kind: merged.kind,
        question: merged.question,
        hint: merged.hint,
        options: merged.options,
        sortOrder: merged.sortOrder,
        enabled: merged.enabled,
        updatedBy: request.user!.id,
      })
      .where(eq(onboardingQuestions.id, before.id))
      .returning();
    const changed = Object.fromEntries(
      Object.keys(input)
        .filter(
          (k) =>
            JSON.stringify(before[k as keyof QuestionRow]) !== JSON.stringify(merged[k as keyof QuestionRow]),
        )
        .map((k) => [k, { from: before[k as keyof QuestionRow], to: merged[k as keyof QuestionRow] }]),
    );
    await log(request, "onboarding_question.updated", before.id, { key: before.key, changed });
    return { question: present(updated!) };
  });

  app.post<IdParams>(`${base}/:id/reset`, guard, async (request) => {
    const before = await find(request.params.id);
    const standard = getStandardQuestion(before.key);
    if (!standard) throw badRequest("This question isn't one of the standard ones");
    const { packs: standardPacks, kind, question, hint, options } = standard;
    const [updated] = await db
      .update(onboardingQuestions)
      .set({ packs: standardPacks, kind, question, hint, options, updatedBy: request.user!.id })
      .where(eq(onboardingQuestions.id, before.id))
      .returning();
    await log(request, "onboarding_question.reset", before.id, { key: before.key });
    return { question: present(updated!) };
  });

  app.post(`${base}/order`, guard, async (request) => {
    const { ids } = orderSchema.parse(request.body);
    const rows = await questionSet(db);
    if (
      ids.length !== rows.length ||
      new Set(ids).size !== ids.length ||
      rows.some((r) => !ids.includes(r.id))
    ) {
      throw badRequest("List every question of the set once");
    }
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        await tx
          .update(onboardingQuestions)
          .set({ sortOrder: (i + 1) * 10 })
          .where(eq(onboardingQuestions.id, id));
      }
    });
    const keys = new Map(rows.map((r) => [r.id, r.key]));
    await log(request, "onboarding_question.reordered", "set", { order: ids.map((id) => keys.get(id)) });
    return { questions: (await questionSet(db)).map(present) };
  });

  app.post(`${base}/restore`, guard, async (request) => {
    const restored = await db
      .insert(onboardingQuestions)
      .values(
        STANDARD_QUESTIONS.map(({ key, packs: p, kind, question, hint, options, sortOrder }) => ({
          key,
          packs: p,
          kind,
          question,
          hint,
          options,
          sortOrder,
          updatedBy: request.user!.id,
        })),
      )
      .onConflictDoNothing({ target: onboardingQuestions.key })
      .returning({ key: onboardingQuestions.key });
    if (restored.length) {
      await log(request, "onboarding_question.restored", "set", { keys: restored.map((r) => r.key) });
    }
    return { restored: restored.map((r) => r.key), questions: (await questionSet(db)).map(present) };
  });

  app.delete<IdParams>(`${base}/:id`, guard, async (request, reply) => {
    const before = await find(request.params.id);
    await db.delete(onboardingQuestions).where(eq(onboardingQuestions.id, before.id));
    await log(request, "onboarding_question.deleted", before.id, { key: before.key });
    return reply.code(204).send();
  });
}
