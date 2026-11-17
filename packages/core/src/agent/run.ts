import {
  type ChatMessage,
  type GatewayResultMeta,
  type LLMGateway,
  type ToolCallBlock,
  type ToolResultBlock,
  toolCallsOf,
} from "@traiblazer/llm";
import { z } from "zod";
import { errorMessage } from "../errors.js";
import type { AgentRegistry } from "./registry.js";
import {
  AGENT_LIMITS,
  type AgentChange,
  type AgentContext,
  type AgentSpec,
  type AgentToolOutcome,
  type AnyAgentTool,
  agentToolDefinition,
  defineAgentTool,
} from "./types.js";

export interface AgentDeps {
  gateway: LLMGateway;
  registry: AgentRegistry;
}

export interface AgentTurnInput {
  /** Id of the agent to run. */
  agent: string;
  /** The conversation so far; the last message is the person's. */
  messages: ChatMessage[];
  ctx: AgentContext;
  /** Facts about this business and moment (its name, today's date), added to the instructions. */
  context?: string;
  /** How many agents asked before this one (0: the person asked). */
  depth?: number;
  /** Told about each step as it starts, to show the person what the agent is doing. */
  onStep?: (step: AgentStep) => void;
}

/**
 * What an agent is doing now. "thinking": a model call (`round` 0 is reading the person's message);
 * "tool": running a tool (`toolkit` is null for an `ask_` tool, whose `delegate` is the agent asked).
 * Steps of an agent that was asked come with its own `agent` id and a `depth` above 0.
 */
export type AgentStep =
  | { type: "thinking"; agent: string; depth: number; round: number }
  | {
      type: "tool";
      agent: string;
      depth: number;
      tool: string;
      toolkit: string | null;
      effect: "read" | "write";
      delegate?: string;
    };

export interface AgentUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  /** Provider and model of the last call. */
  provider: string | null;
  model: string | null;
}

export interface AgentTurnResult {
  /** The agent's answer to the person (empty when it ran out of rounds without one). */
  reply: string;
  /** What its tools (and the agents it asked) changed, in order. */
  changes: AgentChange[];
  /** Names of the tools that ran without an error, in order of first use. */
  toolsUsed: string[];
  usage: AgentUsage;
}

const LAST_ROUND_NOTE =
  "(No more tool calls are available for this message. Reply to the person now: say what was done and what is left.)";

const delegateInput = z.object({
  task: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe("What you need, written so the other agent can do it without seeing this conversation."),
});

/** The instructions: the agent's own, the facts of the moment, then each toolkit's and the agents it may ask. */
export function agentInstructions(
  registry: AgentRegistry,
  spec: AgentSpec,
  context: string | undefined,
  delegates: AgentSpec[],
): string {
  const parts = [spec.instructions.trim()];
  if (context?.trim()) parts.push(`<context>\n${context.trim()}\n</context>`);
  for (const toolkit of registry.toolkitsOf(spec)) {
    const names = toolkit.tools.map((t) => t.name).join(", ");
    parts.push(
      `<toolkit id="${toolkit.id}" title="${toolkit.title}" tools="${names}">${toolkit.instructions ? `\n${toolkit.instructions.trim()}\n` : ""}</toolkit>`,
    );
  }
  if (delegates.length) {
    parts.push(
      [
        "Other agents can do things you can't. Hand them a task with their ask_ tool and use their answer:",
        ...delegates.map((d) => `- ask_${d.id}: ${d.description}`),
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

/**
 * Runs one turn of an agent: asks the model, runs the tools it calls, gives it the results, and
 * repeats until it answers (or the rounds run out). Tool problems never throw: an unknown tool, an
 * input that fails its schema or a tool that fails becomes an error result the model can recover
 * from. Write tools run one at a time, in the order the model asked. Only a model failure throws.
 */
export async function runAgent(deps: AgentDeps, input: AgentTurnInput): Promise<AgentTurnResult> {
  const { registry, gateway } = deps;
  const spec = registry.agent(input.agent);
  const depth = input.depth ?? 0;
  const ctx = input.ctx;
  const maxRounds = Math.max(1, spec.maxRounds ?? AGENT_LIMITS.rounds);

  const changes: AgentChange[] = [];
  const toolsUsed: string[] = [];
  const usage: AgentUsage = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
    provider: null,
    model: null,
  };
  const addUsage = (meta: GatewayResultMeta | AgentUsage) => {
    if ("usage" in meta) {
      usage.modelCalls += 1;
      usage.inputTokens += meta.usage.inputTokens;
      usage.outputTokens += meta.usage.outputTokens;
      usage.provider = meta.provider;
      usage.model = meta.model;
    } else {
      usage.modelCalls += meta.modelCalls;
      usage.inputTokens += meta.inputTokens;
      usage.outputTokens += meta.outputTokens;
    }
    usage.costMicros += meta.costMicros;
  };

  // Agents this one may ask, as tools (not past the depth limit, and never itself).
  const delegates =
    depth + 1 < AGENT_LIMITS.depth
      ? (spec.delegates ?? []).filter((id) => id !== spec.id).map((id) => registry.agent(id))
      : [];
  const delegateTools: AnyAgentTool[] = delegates.map((other) =>
    defineAgentTool({
      name: `ask_${other.id}`,
      description: `Ask the ${other.name} agent: ${other.description}`,
      input: delegateInput,
      effect: "write",
      run: async ({ task }) => {
        const result = await runAgent(deps, {
          agent: other.id,
          messages: [{ role: "user", content: task }],
          ctx,
          context: input.context,
          depth: depth + 1,
          onStep: input.onStep,
        });
        addUsage(result.usage);
        changes.push(...result.changes);
        return { content: result.reply || "(The agent didn't answer.)" };
      },
    }),
  );

  const own = registry.toolsOf(spec);
  const tools = [...own.map((t) => t.tool), ...delegateTools];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolkitOf = new Map(own.map(({ tool, toolkit }) => [tool.name, toolkit.id]));
  /** A listener that fails never stops the agent. */
  const report = (step: AgentStep) => {
    try {
      input.onStep?.(step);
    } catch {
      // Showing progress is never worth failing the turn.
    }
  };
  const definitions = tools.map(agentToolDefinition);
  const system = [
    { text: agentInstructions(registry, spec, input.context, delegates), cacheBreakpoint: true },
  ];

  const runOne = async (call: ToolCallBlock, index: number): Promise<AgentToolOutcome> => {
    if (index >= AGENT_LIMITS.callsPerRound) {
      return { isError: true, content: "Too many tool calls at once. Use the results you already have." };
    }
    const tool = byName.get(call.name);
    if (!tool) return { isError: true, content: `There is no tool named "${call.name}".` };
    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) {
      return {
        isError: true,
        content: JSON.stringify({
          error: "The input doesn't match this tool's schema.",
          problems: parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
        }),
      };
    }
    const delegate = tool.name.startsWith("ask_") ? tool.name.slice(4) : undefined;
    report({
      type: "tool",
      agent: spec.id,
      depth,
      tool: tool.name,
      toolkit: toolkitOf.get(tool.name) ?? null,
      effect: tool.effect,
      ...(delegate ? { delegate } : {}),
    });
    try {
      const outcome = await tool.run(parsed.data, ctx);
      if (!outcome.isError && !toolsUsed.includes(tool.name)) toolsUsed.push(tool.name);
      if (outcome.changes) changes.push(...outcome.changes);
      return outcome;
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      ctx.log?.("agent tool failed", { agent: spec.id, tool: tool.name, error: errorMessage(error) });
      return { isError: true, content: "This tool failed. Nothing was changed by this call." };
    }
  };

  const turn: ChatMessage[] = [...input.messages];
  let reply = "";
  // Up to maxRounds rounds of tools, then the model answers (the last round's results say so).
  for (let round = 0; ; round++) {
    report({ type: "thinking", agent: spec.id, depth, round });
    const result = await gateway.complete("agent", {
      system,
      messages: turn,
      tools: definitions,
      maxTokens: AGENT_LIMITS.maxTokens,
      effort: "medium",
      signal: ctx.signal,
    });
    addUsage(result);
    reply = result.text.trim();
    const calls = toolCallsOf(result.message);
    if (result.stopReason !== "tool_use" || !result.message || !calls.length || round >= maxRounds) break;

    // In order, one at a time: two changes to the same thing land in the order they were asked.
    const results: ToolResultBlock[] = [];
    const lastRound = round === maxRounds - 1;
    for (const [index, call] of calls.entries()) {
      const outcome = await runOne(call, index);
      results.push({
        type: "tool_result",
        toolCallId: call.id,
        content: lastRound ? `${outcome.content}\n\n${LAST_ROUND_NOTE}` : outcome.content,
        ...(outcome.isError ? { isError: true } : {}),
      });
    }
    turn.push(result.message, { role: "user", content: results });
    // Text written next to tool calls ("Let me check") isn't the answer.
    reply = "";
  }

  return { reply, changes, toolsUsed, usage };
}
