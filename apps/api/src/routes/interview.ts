import { enqueueJob, JOB_TYPES } from "@traiblazer/core";
import { withTenant } from "@traiblazer/db";
import { interviewAnswersSchema } from "@traiblazer/shared";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { readInterview, saveInterview } from "../lib/interview.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string } };

export { interviewText } from "../lib/interview.js";

/**
 * Interview mode of the setup assistant: the questions for the business's industry (staff keep the
 * set in the operator console), also asked by the onboarding chat when a business signs up.
 *   GET /v1/tenants/:t/bots/:b/interview   the questions for its industry, and the saved answers
 *   PUT /v1/tenants/:t/bots/:b/interview   save the answers as a knowledge source (one per assistant)
 * The answers are indexed like pasted text; with every answer empty the source is removed. The
 * owner's agent saves answers through the same code (lib/interview.ts).
 */
export async function interviewRoutes(app: FastifyInstance, { db }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots/:botId/interview";

  app.get<BotParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    return withTenant(db, request.tenant!.id, (tx) => readInterview(tx, botId));
  });

  app.put<BotParams>(base, { preHandler: requireTenantRole(db, "editor") }, async (request) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    const input = interviewAnswersSchema.parse(request.body);
    const tenantId = request.tenant!.id;

    const result = await withTenant(db, tenantId, (tx) =>
      saveInterview(tx, { tenantId, botId, actorUserId: request.user!.id, answers: input.answers }),
    );

    if (result.queued && result.sourceId) {
      await enqueueJob(db, { tenantId, type: JOB_TYPES.sourceSync, payload: { sourceId: result.sourceId } });
    }
    return { sourceId: result.sourceId, answers: result.answers };
  });
}
