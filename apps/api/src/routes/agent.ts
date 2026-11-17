import { type AgentChange, type AgentStep, runAgent } from "@traiblazer/core";
import { usageEvents, withTenant } from "@traiblazer/db";
import type { ChatMessage } from "@traiblazer/llm";
import { type AgentChatInput, agentChatSchema } from "@traiblazer/shared";
import type { FastifyInstance } from "fastify";
import { OWNER_AGENT, ownerAgents, ownerContext } from "../agent/owner.js";
import type { AppContext } from "../context.js";
import { HttpError, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { requireTenantRole } from "../plugins/auth.js";

type BotParams = { Params: { tenantId: string; botId: string } };

/** Messages one person can send the agent in a minute (each is several model calls). */
export const AGENT_PER_MINUTE = 20;

/** What a streamed answer sends, one server-sent event each. */
export type AgentStreamEvent =
  | { type: "step"; step: AgentStep }
  | { type: "done"; reply: string; changes: AgentChange[] }
  | { type: "error"; code: string; message: string };

/**
 * The conversation as the model reads it: it starts with the person (a greeting the portal showed
 * first is left out), and two messages in a row from the same side are joined.
 */
export function toModelMessages(messages: AgentChatInput["messages"]): ChatMessage[] {
  const start = messages.findIndex((m) => m.role === "user");
  const out: ChatMessage[] = [];
  for (const message of messages.slice(start)) {
    const last = out.at(-1);
    if (last && last.role === message.role) last.content = `${last.content as string}\n\n${message.text}`;
    else out.push({ role: message.role, content: message.text });
  }
  return out;
}

/**
 * The owner's agent (docs/AGENT.md):
 *   POST /v1/tenants/:t/bots/:b/agent   one message to the agent; it may change the business's
 *                                       information, and says what it changed
 * Editors and up. The conversation is kept by the portal and sent each time; nothing of it is
 * stored here. Changes are audited like the portal's forms (with `via: "agent"`).
 *
 * Answers `{ reply, changes }` as JSON, or, when asked for `text/event-stream`, streams each step as
 * the agent starts it (so the portal can say "Checking your opening hours…"), then the answer.
 * Problems found before the agent starts (validation, access, no tool-capable model) are plain
 * JSON errors either way.
 */
export async function agentRoutes(app: FastifyInstance, { db, gateway, embeddings }: AppContext) {
  const registry = ownerAgents({ embeddings: Boolean(embeddings) });

  app.post<BotParams>(
    "/v1/tenants/:tenantId/bots/:botId/agent",
    {
      preHandler: requireTenantRole(db, "editor"),
      config: { rateLimit: { max: AGENT_PER_MINUTE, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { botId } = request.params;
      if (!isUuid(botId)) throw notFound("Assistant");
      const input = agentChatSchema.parse(request.body);
      if (!gateway.supportsTools("agent")) {
        throw new HttpError(503, "agent_unavailable", "The agent needs a model that can use tools");
      }
      const tenantId = request.tenant!.id;
      const context = await withTenant(db, tenantId, (tx) => ownerContext(tx, botId, new Date()));

      /** One turn of the agent, its usage recorded. A model failure is a 503. */
      const turn = async (onStep?: (step: AgentStep) => void, signal?: AbortSignal) => {
        let result: Awaited<ReturnType<typeof runAgent>>;
        try {
          result = await runAgent(
            { gateway, registry },
            {
              agent: OWNER_AGENT,
              messages: toModelMessages(input.messages),
              context,
              onStep,
              ctx: {
                db,
                tenantId,
                botId,
                userId: request.user!.id,
                language: input.language ?? "en",
                signal,
                log: (msg, data) => request.log.warn(data ?? {}, msg),
              },
            },
          );
        } catch (error) {
          request.log.warn({ err: error }, "owner agent: model unavailable");
          throw new HttpError(503, "agent_unavailable", "The agent couldn't answer. Please try again.");
        }
        await withTenant(db, tenantId, (tx) =>
          tx.insert(usageEvents).values({
            tenantId,
            kind: "llm.agent",
            quantity: result.usage.inputTokens + result.usage.outputTokens,
            costMicros: result.usage.costMicros,
            metadata: {
              task: "owner_agent",
              botId,
              provider: result.usage.provider,
              model: result.usage.model,
              modelCalls: result.usage.modelCalls,
              tools: result.toolsUsed,
            },
          }),
        );
        return { reply: result.reply, changes: result.changes };
      };

      if (!request.headers.accept?.includes("text/event-stream")) return turn();

      // Streamed: each step as it starts ("step"), then the answer ("done") or "error".
      const controller = new AbortController();
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      });
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const send = (event: AgentStreamEvent) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      try {
        send({ type: "done", ...(await turn((step) => send({ type: "step", step }), controller.signal)) });
      } catch (error) {
        const known = error instanceof HttpError;
        if (!known) request.log.error({ err: error }, "owner agent stream failed");
        send({
          type: "error",
          code: known ? error.code : "failed",
          message: known ? error.message : "Something went wrong",
        });
      } finally {
        res.end();
      }
    },
  );
}
