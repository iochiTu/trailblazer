import type { Db } from "@traiblazer/db";
import type { ToolDefinition } from "@traiblazer/llm";
import { z } from "zod";

/**
 * Owner-side agents: a model that works for the business's owner (or staff) and changes the
 * business's own settings by calling tools. Unlike the visitor chat (chat/tools), these tools write.
 *
 * The pieces, smallest first:
 *   - AgentTool   one thing the agent can do ("set_opening_hours"). Input is a Zod schema; every
 *                 call is validated before `run`, and a tool returns text for the model.
 *   - Toolkit     a named group of tools about one area (business details, interview, answers), with
 *                 a few lines of instructions for using them. Toolkits are what gets plugged in:
 *                 a new area of the product, or an outside service, is a new toolkit.
 *   - AgentSpec   an agent: instructions plus the toolkits it may use, and other agents it may ask
 *                 (each becomes an `ask_<agent>` tool, see delegate.ts).
 *   - AgentRegistry  where toolkits and agents are registered (registry.ts); `runAgent` (run.ts)
 *                 runs one turn of an agent from it.
 *
 * Tools run on the server under the signed-in person's business, with only what `AgentContext`
 * gives them: the model chooses a tool and its input, never which business it applies to.
 */
export interface AgentContext {
  db: Db;
  tenantId: string;
  botId: string;
  /** The person the agent works for (audit entries name them). */
  userId: string;
  /** Language the person writes in (the portal's language), e.g. "en" or "fr". */
  language: string;
  /** The current time (tests set it). */
  now?: () => Date;
  signal?: AbortSignal;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/** Something a tool changed, shown to the person under the agent's reply. */
export interface AgentChange {
  /** The toolkit the change belongs to (the portal links to where it can be seen). */
  area: string;
  /** One short sentence for people: "Opening hours updated (Saturday)". */
  summary: string;
}

export interface AgentToolOutcome {
  /** What the model reads. */
  content: string;
  /** The tool couldn't do what was asked; the model is told so and can recover. */
  isError?: boolean;
  /** What was changed (write tools that changed something). */
  changes?: AgentChange[];
}

export interface AgentTool<I = unknown> {
  /** Stable name the model calls it by (snake_case, unique across an agent's toolkits). */
  name: string;
  /** What it does and when to use it, written for the model. */
  description: string;
  input: z.ZodType<I>;
  /** "read" tools only look; "write" tools change the business's data (and are run one at a time). */
  effect: "read" | "write";
  run(input: I, ctx: AgentContext): Promise<AgentToolOutcome>;
}

// biome-ignore lint/suspicious/noExplicitAny: a toolkit holds tools with different input types
export type AnyAgentTool = AgentTool<any>;

/** Typed helper so each tool's `run` sees its own input type. */
export const defineAgentTool = <I>(tool: AgentTool<I>): AgentTool<I> => tool;

export interface Toolkit {
  /** Stable id ("business", "interview"); also the `area` of the changes its tools make. */
  id: string;
  /** What the toolkit is about, for the agent's instructions. */
  title: string;
  /** How to use these tools well (added to the instructions of every agent that has the toolkit). */
  instructions?: string;
  tools: AnyAgentTool[];
}

export interface AgentSpec {
  /** Stable id (snake_case): other agents ask it with the tool `ask_<id>`. */
  id: string;
  name: string;
  /** What it is good at, for an agent that may ask it (the description of its `ask_` tool). */
  description: string;
  /** Its role and rules (the system prompt, before the toolkits' instructions). */
  instructions: string;
  /** Ids of the toolkits it may use. */
  toolkits: string[];
  /** Ids of agents it may hand a task to. */
  delegates?: string[];
  /** Most rounds of tool calls in one turn (default AGENT_LIMITS.rounds). */
  maxRounds?: number;
}

export const AGENT_LIMITS = {
  /** Rounds of tool calls in one turn of an agent. */
  rounds: 8,
  /** Tool calls run from one model turn (extra ones are refused). */
  callsPerRound: 8,
  /** How deep agents may ask agents (the first agent is depth 0). */
  depth: 2,
  /** Output tokens for one model call. */
  maxTokens: 2_000,
} as const;

/**
 * The tool as a model sees it. The schema is described as input (what the model writes): shared
 * schemas often tidy values with transforms, which have no JSON Schema of their own.
 */
export function agentToolDefinition(tool: AnyAgentTool): ToolDefinition {
  const { $schema: _, ...inputSchema } = z.toJSONSchema(tool.input, { io: "input" }) as Record<
    string,
    unknown
  >;
  return { name: tool.name, description: tool.description, inputSchema };
}
