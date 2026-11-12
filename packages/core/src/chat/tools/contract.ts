import type { AddonEvent } from "@traiblazer/addons";
import type { Channel, Db } from "@traiblazer/db";
import type {
  QueryEmbedder,
  QueryVector,
  ToolCallBlock,
  ToolDefinition,
  ToolResultBlock,
} from "@traiblazer/llm";
import { z } from "zod";
import type { Passage } from "../retrieval.js";

/**
 * Tools the assistant can call while answering. A tool is the one way the assistant does something
 * beyond writing text: look something up now; later, save a visitor's request or hand off to staff.
 *
 * A tool declares its input as a Zod schema (the model sees it as JSON Schema; every call is
 * validated against it before `run`) and returns text for the model. Tools run on the server, under
 * the assistant's tenant, with only what `ToolContext` gives them: the model chooses a tool and its
 * input, never which business or conversation it applies to.
 */
export interface ToolContext {
  db: Db;
  tenantId: string;
  botId: string;
  conversationId: string;
  /** Where the visitor is chatting; "playground" is the owner's own test chat. */
  channel: Channel;
  /** Language the visitor is writing in, when known. */
  language: string | null;
  /** The visitor's latest message was triaged as urgent or a danger (see triage.ts). */
  urgent?: boolean;
  embeddings?: QueryEmbedder | null;
  /** Told about each question vector a tool used (for usage records). */
  onEmbedding?: (vector: QueryVector | null) => void;
  signal?: AbortSignal;
}

export interface ToolOutcome {
  /** What the model reads. Business text in here is reference data, like <knowledge>. */
  content: string;
  /** The tool couldn't do what was asked; the model is told so and can answer without it. */
  isError?: boolean;
  /** Business information the tool found (counts toward the answer's sources). */
  passages?: Passage[];
  /** Things that happened, for add-ons (e.g. a notification email). Delivered after the answer is stored. */
  events?: AddonEvent[];
}

export interface ChatTool<I = unknown> {
  /** Stable name the model calls it by (snake_case). */
  name: string;
  /** What it does and when to use it, written for the model. */
  description: string;
  input: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Any tool, whatever its input type. */
// biome-ignore lint/suspicious/noExplicitAny: the tool list holds tools with different input types
export type AnyChatTool = ChatTool<any>;

/** Typed helper so each tool's `run` sees its own input type. */
export const defineTool = <I>(tool: ChatTool<I>): ChatTool<I> => tool;

/** The tool as a model sees it. */
export function toToolDefinition(tool: AnyChatTool): ToolDefinition {
  const { $schema: _, ...inputSchema } = z.toJSONSchema(tool.input) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, inputSchema };
}

/** Most rounds of tool calls in one answer; after that the assistant answers with what it has. */
export const MAX_TOOL_ROUNDS = 3;
/** Most tool calls run from a single model turn (extra ones are refused). */
export const MAX_CALLS_PER_ROUND = 4;

const LAST_ROUND_NOTE =
  "(No more lookups are available for this message. Answer now with the information you have.)";

/**
 * Runs one model turn's tool calls and returns a result for every call, in order. Nothing here
 * throws: unknown tools, inputs that fail validation and tools that fail all become error results,
 * so the model can recover and still answer the visitor.
 */
export async function runToolCalls(
  tools: AnyChatTool[],
  calls: ToolCallBlock[],
  ctx: ToolContext,
  options: { lastRound?: boolean; log?: (msg: string, data?: Record<string, unknown>) => void } = {},
): Promise<{ results: ToolResultBlock[]; passages: Passage[]; events: AddonEvent[]; used: string[] }> {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const passages: Passage[] = [];
  const events: AddonEvent[] = [];
  const used: string[] = [];

  const runOne = async (call: ToolCallBlock, index: number): Promise<ToolOutcome> => {
    if (index >= MAX_CALLS_PER_ROUND) {
      return { isError: true, content: "Too many lookups at once. Use the results you already have." };
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
          received: call.input,
        }),
      };
    }
    try {
      const outcome = await tool.run(parsed.data, ctx);
      if (!outcome.isError) used.push(tool.name);
      return outcome;
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      options.log?.("tool failed", {
        tool: tool.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return { isError: true, content: "This lookup failed. Answer with the information you already have." };
    }
  };

  const outcomes = await Promise.all(calls.map(runOne));
  const results = outcomes.map((outcome, i): ToolResultBlock => {
    if (outcome.passages) passages.push(...outcome.passages);
    if (outcome.events) events.push(...outcome.events);
    return {
      type: "tool_result",
      toolCallId: calls[i]!.id,
      content: options.lastRound ? `${outcome.content}\n\n${LAST_ROUND_NOTE}` : outcome.content,
      ...(outcome.isError ? { isError: true } : {}),
    };
  });
  return { results, passages, events, used };
}
