import {
  defineAgentTool,
  enqueueEmbedding,
  guessLanguage,
  type Toolkit,
  tsvectorSql,
} from "@traiblazer/core";
import { qaPairs } from "@traiblazer/db";
import { qaPairSchema } from "@traiblazer/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { inScope, json } from "./scope.js";

/** Most pairs listed for the model at once. */
const LIST_LIMIT = 100;

const columns = {
  id: qaPairs.id,
  question: qaPairs.question,
  answer: qaPairs.answer,
  language: qaPairs.language,
  enabled: qaPairs.enabled,
};

const pairId = z.uuid().describe("The answer's id, from list_answers");

/**
 * Question-and-answer pairs: the owner's own answers to questions customers ask, which the
 * assistant uses word for word. `embeddings` is whether search by meaning is on (new text then gets
 * its vector from the worker).
 */
export function answersToolkit(options: { embeddings: boolean }): Toolkit {
  const embedLater = async (ctx: {
    db: Parameters<typeof enqueueEmbedding>[0];
    tenantId: string;
    botId: string;
  }) => {
    if (options.embeddings) await enqueueEmbedding(ctx.db, ctx.tenantId, ctx.botId);
  };

  return {
    id: "answers",
    title: "Answers to common questions",
    instructions: [
      "Question-and-answer pairs are the owner's own answers to questions customers ask; the assistant uses them as written.",
      "Before adding one, call list_answers: when a pair about the same thing exists, update it instead of adding a second.",
      "Write the question the way a customer would ask it, and the answer as the business would reply.",
      "Ask the person to confirm before removing a pair.",
    ].join("\n"),
    tools: [
      defineAgentTool({
        name: "list_answers",
        description: "The business's question-and-answer pairs (newest first), with their ids.",
        input: z.object({}),
        effect: "read",
        run: async (_input, ctx) => {
          const rows = await inScope(ctx, (tx) =>
            tx
              .select(columns)
              .from(qaPairs)
              .where(eq(qaPairs.botId, ctx.botId))
              .orderBy(desc(qaPairs.createdAt))
              .limit(LIST_LIMIT),
          );
          return { content: json(rows) };
        },
      }),
      defineAgentTool({
        name: "add_answer",
        description: "Add a question-and-answer pair. language is the pair's language code (e.g. en, fr).",
        input: qaPairSchema,
        effect: "write",
        run: async (input, ctx) => {
          const language = input.language ?? guessLanguage(`${input.question}\n${input.answer}`) ?? "en";
          const row = await inScope(ctx, async (tx) => {
            const [created] = await tx
              .insert(qaPairs)
              .values({
                tenantId: ctx.tenantId,
                botId: ctx.botId,
                question: input.question,
                answer: input.answer,
                language,
                tsv: tsvectorSql(`${input.question}\n${input.answer}`, language) as unknown as string,
              })
              .returning(columns);
            await audit(tx, {
              tenantId: ctx.tenantId,
              actorUserId: ctx.userId,
              action: "qa.created",
              targetType: "qa_pair",
              targetId: created!.id,
              metadata: { via: "agent" },
            });
            return created!;
          });
          await embedLater(ctx);
          return {
            content: json({ added: row }),
            changes: [{ area: "answers", summary: `Answer added: "${row.question}"` }],
          };
        },
      }),
      defineAgentTool({
        name: "update_answer",
        description: "Change a question-and-answer pair's question, answer, or whether it is used (enabled).",
        input: z
          .object({
            id: pairId,
            question: qaPairSchema.shape.question.optional(),
            answer: qaPairSchema.shape.answer.optional(),
            enabled: z.boolean().optional(),
          })
          .refine((v) => v.question !== undefined || v.answer !== undefined || v.enabled !== undefined, {
            message: "Give something to change",
          }),
        effect: "write",
        run: async ({ id, ...change }, ctx) => {
          const row = await inScope(ctx, async (tx) => {
            const [current] = await tx
              .select(columns)
              .from(qaPairs)
              .where(and(eq(qaPairs.id, id), eq(qaPairs.botId, ctx.botId)))
              .limit(1);
            if (!current) return null;
            const question = change.question ?? current.question;
            const answer = change.answer ?? current.answer;
            const [updated] = await tx
              .update(qaPairs)
              .set({
                question,
                answer,
                ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
                tsv: tsvectorSql(`${question}\n${answer}`, current.language) as unknown as string,
              })
              .where(eq(qaPairs.id, id))
              .returning(columns);
            await audit(tx, {
              tenantId: ctx.tenantId,
              actorUserId: ctx.userId,
              action: "qa.updated",
              targetType: "qa_pair",
              targetId: id,
              metadata: { fields: Object.keys(change), via: "agent" },
            });
            return updated!;
          });
          if (!row)
            return { isError: true, content: "No answer with that id. Call list_answers for the ids." };
          if (change.question !== undefined || change.answer !== undefined) await embedLater(ctx);
          return {
            content: json({ updated: row }),
            changes: [{ area: "answers", summary: `Answer updated: "${row.question}"` }],
          };
        },
      }),
      defineAgentTool({
        name: "remove_answer",
        description: "Delete a question-and-answer pair. Only after the person confirmed it.",
        input: z.object({ id: pairId }),
        effect: "write",
        run: async ({ id }, ctx) => {
          const removed = await inScope(ctx, async (tx) => {
            const [row] = await tx
              .delete(qaPairs)
              .where(and(eq(qaPairs.id, id), eq(qaPairs.botId, ctx.botId)))
              .returning({ id: qaPairs.id, question: qaPairs.question });
            if (row) {
              await audit(tx, {
                tenantId: ctx.tenantId,
                actorUserId: ctx.userId,
                action: "qa.deleted",
                targetType: "qa_pair",
                targetId: id,
                metadata: { via: "agent" },
              });
            }
            return row ?? null;
          });
          if (!removed)
            return { isError: true, content: "No answer with that id. Call list_answers for the ids." };
          return {
            content: json({ removed }),
            changes: [{ area: "answers", summary: `Answer removed: "${removed.question}"` }],
          };
        },
      }),
    ],
  };
}
