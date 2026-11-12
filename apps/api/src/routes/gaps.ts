import { enqueueEmbedding, tsvectorSql } from "@traiblazer/core";
import { bots, gapStatuses, knowledgeGaps, qaPairs, withTenant } from "@traiblazer/db";
import { qaPairSchema, updateGapSchema } from "@traiblazer/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string }; Querystring: { status?: string } };
type GapParams = { Params: { tenantId: string; botId: string; gapId: string } };
type Status = (typeof gapStatuses)[number];

/**
 * Questions the assistant couldn't answer from the business's information:
 *   GET   /v1/tenants/:t/bots/:b/gaps[?status=open]       most asked first, with how many are open
 *   POST  /v1/tenants/:t/bots/:b/gaps/:gapId/answer       add the answer as a Q&A pair; marks it answered
 *   PATCH /v1/tenants/:t/bots/:b/gaps/:gapId              dismiss, or put back on the list
 *
 * Reading needs the viewer role; answering and dismissing need editor, like the rest of the knowledge.
 */
export async function gapRoutes(app: FastifyInstance, { db, embeddings }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots/:botId/gaps";

  app.get<BotParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { botId } = request.params;
    const status = (request.query.status ?? "open") as Status;
    if (!isUuid(botId)) throw notFound("Assistant");
    if (!gapStatuses.includes(status)) throw badRequest("Unknown status");
    return withTenant(db, request.tenant!.id, async (tx) => {
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      const gaps = await tx
        .select()
        .from(knowledgeGaps)
        .where(and(eq(knowledgeGaps.botId, botId), eq(knowledgeGaps.status, status)))
        .orderBy(desc(knowledgeGaps.occurrences), desc(knowledgeGaps.lastAskedAt))
        .limit(100);
      const [counts] = await tx
        .select({ openCount: sql<number>`count(*) filter (where ${knowledgeGaps.status} = 'open')::int` })
        .from(knowledgeGaps)
        .where(eq(knowledgeGaps.botId, botId));
      return { gaps, openCount: counts?.openCount ?? 0 };
    });
  });

  app.post<GapParams>(
    `${base}/:gapId/answer`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { botId, gapId } = request.params;
      if (!isUuid(botId) || !isUuid(gapId)) throw notFound("Question");
      const input = qaPairSchema.parse(request.body);
      const result = await withTenant(db, request.tenant!.id, async (tx) => {
        const [gap] = await tx
          .select()
          .from(knowledgeGaps)
          .where(and(eq(knowledgeGaps.id, gapId), eq(knowledgeGaps.botId, botId)))
          .limit(1);
        if (!gap) throw notFound("Question");
        // The answer is written in the business's language, which may not be the visitor's.
        const language = input.language ?? "en";
        const [pair] = await tx
          .insert(qaPairs)
          .values({
            tenantId: request.tenant!.id,
            botId,
            question: input.question,
            answer: input.answer,
            language,
            tsv: tsvectorSql(`${input.question}\n${input.answer}`, language) as unknown as string,
          })
          .returning({
            id: qaPairs.id,
            question: qaPairs.question,
            answer: qaPairs.answer,
            language: qaPairs.language,
            enabled: qaPairs.enabled,
          });
        const [updated] = await tx
          .update(knowledgeGaps)
          .set({ status: "answered", qaPairId: pair!.id })
          .where(eq(knowledgeGaps.id, gapId))
          .returning();
        await audit(tx, {
          tenantId: request.tenant!.id,
          actorUserId: request.user?.id ?? null,
          action: "gap.answer",
          targetType: "knowledge_gap",
          targetId: gapId,
          metadata: { qaPairId: pair!.id },
        });
        return { gap: updated!, pair: pair! };
      });
      // The new answer gets its vector from the worker (search by meaning).
      if (embeddings) await enqueueEmbedding(db, request.tenant!.id, botId);
      return reply.code(201).send(result);
    },
  );

  app.patch<GapParams>(`${base}/:gapId`, { preHandler: requireTenantRole(db, "editor") }, async (request) => {
    const { botId, gapId } = request.params;
    if (!isUuid(botId) || !isUuid(gapId)) throw notFound("Question");
    const { status } = updateGapSchema.parse(request.body);
    return withTenant(db, request.tenant!.id, async (tx) => {
      const [gap] = await tx
        .update(knowledgeGaps)
        .set({ status })
        .where(and(eq(knowledgeGaps.id, gapId), eq(knowledgeGaps.botId, botId)))
        .returning();
      if (!gap) throw notFound("Question");
      await audit(tx, {
        tenantId: request.tenant!.id,
        actorUserId: request.user?.id ?? null,
        action: "gap.update",
        targetType: "knowledge_gap",
        targetId: gapId,
        metadata: { status },
      });
      return { gap };
    });
  });
}
