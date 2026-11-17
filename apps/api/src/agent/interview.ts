import { defineAgentTool, enqueueJob, JOB_TYPES, type Toolkit } from "@traiblazer/core";
import { INTERVIEW_LIMITS } from "@traiblazer/industry-packs";
import { z } from "zod";
import { readInterview, saveInterview } from "../lib/interview.js";
import { inScope, json } from "./scope.js";

const tier1 = (language: string): "en" | "fr" => (language.startsWith("fr") ? "fr" : "en");

/** The setup interview (the onboarding chat's questions for the business's industry) and its answers. */
export const interviewToolkit: Toolkit = {
  id: "interview",
  title: "Setup interview answers",
  instructions: [
    "The setup interview is the list of questions the owner answered when they signed up (parking, payment, policies...). The assistant uses the answers to answer visitors.",
    "Call get_interview to see the questions, their keys and the current answers. To change answers, give update_interview_answers only the keys that change.",
    "Write answers in the owner's words, as complete sentences a visitor would understand. For a question with options, pick the option text when one fits.",
    "Only the interview's own questions can be answered here; for anything else, a question-and-answer pair (the answers tools) is the right place.",
  ].join("\n"),
  tools: [
    defineAgentTool({
      name: "get_interview",
      description:
        "The setup interview's questions for this business (key, question, hint, options) and the current answers.",
      input: z.object({}),
      effect: "read",
      run: async (_input, ctx) => {
        const lang = tier1(ctx.language);
        const { questions, answers } = await inScope(ctx, (tx) => readInterview(tx, ctx.botId));
        return {
          content: json(
            questions.map((q) => ({
              key: q.key,
              question: q.question[lang],
              ...(q.hint[lang] ? { hint: q.hint[lang] } : {}),
              ...(q.options.length ? { options: q.options.map((o) => o[lang]) } : {}),
              answer: answers[q.key] ?? null,
            })),
          ),
        };
      },
    }),
    defineAgentTool({
      name: "update_interview_answers",
      description:
        "Change answers to the setup interview, by question key. Only the keys given change; an empty string removes that answer.",
      input: z.object({
        answers: z
          .record(z.string().max(40), z.string().max(INTERVIEW_LIMITS.answerLength))
          .refine((v) => Object.keys(v).length > 0, { message: "Give at least one answer" }),
      }),
      effect: "write",
      run: async ({ answers }, ctx) => {
        const result = await inScope(ctx, async (tx) => {
          const current = await readInterview(tx, ctx.botId);
          const known = new Set(current.questions.map((q) => q.key));
          const unknown = Object.keys(answers).filter((key) => !known.has(key));
          if (unknown.length) return { unknown };
          const saved = await saveInterview(tx, {
            tenantId: ctx.tenantId,
            botId: ctx.botId,
            actorUserId: ctx.userId,
            answers: { ...current.answers, ...answers },
            via: "agent",
          });
          return { saved };
        });
        if ("unknown" in result) {
          return {
            isError: true,
            content: `Unknown question key: ${result.unknown!.join(", ")}. Call get_interview for the keys.`,
          };
        }
        const { saved } = result;
        if (saved.queued && saved.sourceId) {
          await enqueueJob(ctx.db, {
            tenantId: ctx.tenantId,
            type: JOB_TYPES.sourceSync,
            payload: { sourceId: saved.sourceId },
          });
        }
        const keys = Object.keys(answers);
        return {
          content: json({ saved: keys, answers: saved.answers }),
          changes: [{ area: "interview", summary: `Interview answers updated (${keys.length})` }],
        };
      },
    }),
  ],
};
