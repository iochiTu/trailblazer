import { enqueueJob, JOB_TYPES, tsvectorSql } from "@traiblazer/core";
import { bots, businessProfiles, documents, qaPairs, setupRuns, withTenant } from "@traiblazer/db";
import { applySetupSchema } from "@traiblazer/shared";
import { and, count, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string } };
type RunParams = { Params: { tenantId: string; botId: string; runId: string } };
type Run = typeof setupRuns.$inferSelect;

/** Runs one assistant can start in a day (each is a model call the platform pays for). */
export const SETUP_RUNS_PER_DAY = 5;
/** A run still not finished after this long is treated as failed (the worker stopped). */
const STALE_MS = 20 * 60 * 1000;

const unfinished = (run: Run) => run.status === "pending" || run.status === "running";
const stale = (run: Run) => unfinished(run) && Date.now() - run.updatedAt.getTime() > STALE_MS;

/** A run as the portal sees it. */
const publicRun = (run: Run) => ({
  id: run.id,
  status: stale(run) ? ("failed" as const) : run.status,
  suggestion: run.status === "ready" ? run.suggestion : null,
  error: stale(run) ? "timed_out" : run.error,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});

/**
 * The setup assistant: reads the business's information and suggests how to set the assistant up.
 *   GET    /v1/tenants/:t/bots/:b/setup                  the latest run, and whether there is anything to read
 *   POST   /v1/tenants/:t/bots/:b/setup                  start a run (in the worker)
 *   POST   /v1/tenants/:t/bots/:b/setup/:runId/apply     save what the owner kept from the suggestion
 *   DELETE /v1/tenants/:t/bots/:b/setup/:runId           discard a finished run
 *
 * Reading needs the viewer role; the rest need editor, like the settings they change.
 */
export async function setupRoutes(app: FastifyInstance, { db }: AppContext) {
  const base = "/v1/tenants/:tenantId/bots/:botId/setup";

  app.get<BotParams>(base, { preHandler: requireTenantRole(db, "viewer") }, async (request) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    return withTenant(db, request.tenant!.id, async (tx) => {
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      const [run] = await tx
        .select()
        .from(setupRuns)
        .where(eq(setupRuns.botId, botId))
        .orderBy(desc(setupRuns.createdAt))
        .limit(1);
      const [pages] = await tx.select({ n: count() }).from(documents).where(eq(documents.botId, botId));
      return { run: run ? publicRun(run) : null, pages: pages?.n ?? 0 };
    });
  });

  app.post<BotParams>(base, { preHandler: requireTenantRole(db, "editor") }, async (request, reply) => {
    const { botId } = request.params;
    if (!isUuid(botId)) throw notFound("Assistant");
    const tenantId = request.tenant!.id;
    const run = await withTenant(db, tenantId, async (tx) => {
      const [bot] = await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
      if (!bot) throw notFound("Assistant");
      const [pages] = await tx.select({ n: count() }).from(documents).where(eq(documents.botId, botId));
      if (!pages?.n) {
        throw new HttpError(409, "setup_no_information", "Add your website or some text first");
      }
      const recent = await tx
        .select()
        .from(setupRuns)
        .where(
          and(eq(setupRuns.botId, botId), gt(setupRuns.createdAt, new Date(Date.now() - 24 * 3600 * 1000))),
        );
      if (recent.some((r) => unfinished(r) && !stale(r))) {
        throw new HttpError(409, "setup_running", "Your information is already being read");
      }
      if (recent.length >= SETUP_RUNS_PER_DAY) {
        throw new HttpError(429, "setup_limit", "You can run this a few times a day. Try again tomorrow.");
      }
      const [row] = await tx
        .insert(setupRuns)
        .values({ tenantId, botId, createdBy: request.user?.id ?? null })
        .returning();
      await audit(tx, {
        tenantId,
        actorUserId: request.user?.id ?? null,
        action: "setup.started",
        targetType: "bot",
        targetId: botId,
      });
      return row!;
    });
    await enqueueJob(db, { tenantId, type: JOB_TYPES.botSetup, payload: { runId: run.id } });
    return reply.code(201).send({ run: publicRun(run) });
  });

  app.post<RunParams>(
    `${base}/:runId/apply`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request) => {
      const { botId, runId } = request.params;
      if (!isUuid(botId) || !isUuid(runId)) throw notFound("Suggestion");
      const input = applySetupSchema.parse(request.body);
      const tenantId = request.tenant!.id;

      return withTenant(db, tenantId, async (tx) => {
        const [run] = await tx
          .select()
          .from(setupRuns)
          .where(and(eq(setupRuns.id, runId), eq(setupRuns.botId, botId)))
          .limit(1);
        if (run?.status !== "ready") throw notFound("Suggestion");
        const [bot] = await tx.select().from(bots).where(eq(bots.id, botId)).limit(1);
        if (!bot) throw notFound("Assistant");

        if (input.profile && Object.keys(input.profile).length) {
          await tx.update(businessProfiles).set(input.profile).where(eq(businessProfiles.botId, botId));
        }

        // Texts are kept per language, and only for languages the assistant offers.
        const offered = <T>(texts: Record<string, T> | undefined) =>
          Object.fromEntries(Object.entries(texts ?? {}).filter(([code]) => bot.languages.includes(code)));
        const greeting = offered(input.greeting);
        const quickReplies = offered(input.quickReplies);
        if (Object.keys(greeting).length || Object.keys(quickReplies).length) {
          await tx
            .update(bots)
            .set({
              settings: {
                ...bot.settings,
                greeting: { ...bot.settings.greeting, ...greeting },
                quickReplies: { ...bot.settings.quickReplies, ...quickReplies },
              },
            })
            .where(eq(bots.id, botId));
        }

        const answers = input.answers ?? [];
        if (answers.length) {
          await tx.insert(qaPairs).values(
            answers.map((pair) => {
              const language = pair.language ?? bot.defaultLanguage;
              return {
                tenantId,
                botId,
                question: pair.question,
                answer: pair.answer,
                language,
                tsv: tsvectorSql(`${pair.question}\n${pair.answer}`, language) as unknown as string,
              };
            }),
          );
        }

        const [applied] = await tx
          .update(setupRuns)
          .set({ status: "applied" })
          .where(eq(setupRuns.id, runId))
          .returning();
        await audit(tx, {
          tenantId,
          actorUserId: request.user?.id ?? null,
          action: "setup.applied",
          targetType: "bot",
          targetId: botId,
          metadata: {
            profile: Object.keys(input.profile ?? {}),
            greeting: Object.keys(greeting),
            quickReplies: Object.keys(quickReplies),
            answers: answers.length,
          },
        });
        return { run: publicRun(applied!) };
      });
    },
  );

  app.delete<RunParams>(
    `${base}/:runId`,
    { preHandler: requireTenantRole(db, "editor") },
    async (request, reply) => {
      const { botId, runId } = request.params;
      if (!isUuid(botId) || !isUuid(runId)) throw notFound("Suggestion");
      await withTenant(db, request.tenant!.id, async (tx) => {
        const [run] = await tx
          .select()
          .from(setupRuns)
          .where(and(eq(setupRuns.id, runId), eq(setupRuns.botId, botId)))
          .limit(1);
        if (!run) throw notFound("Suggestion");
        // A run the worker is on is left alone: it would write to a row that is gone.
        if (unfinished(run) && !stale(run)) {
          throw new HttpError(409, "setup_running", "Your information is still being read");
        }
        await tx.delete(setupRuns).where(eq(setupRuns.id, runId));
      });
      return reply.code(204).send();
    },
  );
}
