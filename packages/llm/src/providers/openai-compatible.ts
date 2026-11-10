import OpenAI from "openai";
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentBlock,
  LLMProvider,
  StopReason,
  ToolDefinition,
} from "../types.js";
import { emptyUsage } from "../types.js";

type Param = OpenAI.Chat.ChatCompletionMessageParam;

const textBlocks = (blocks: ContentBlock[]) =>
  blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

/**
 * Maps a provider-neutral message to Chat Completions messages (images as `data:` URLs). Usually
 * one message; a user turn carrying tool results becomes one `tool` message per result.
 */
export function toOpenAIMessages(message: ChatMessage): Param[] {
  if (typeof message.content === "string") return [{ role: message.role, content: message.content }];

  if (message.role === "assistant") {
    // Assistant turns are text, plus the tool calls the model made.
    const text = textBlocks(message.content);
    const calls = message.content.filter((b) => b.type === "tool_call");
    if (!calls.length) return [{ role: "assistant", content: text }];
    return [
      {
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
        })),
      },
    ];
  }

  const results: Param[] = message.content
    .filter((b) => b.type === "tool_result")
    .map((result) => ({ role: "tool" as const, tool_call_id: result.toolCallId, content: result.content }));
  const rest = message.content.filter((b) => b.type === "text" || b.type === "image");
  if (!rest.length) return results;
  return [
    ...results,
    {
      role: "user",
      content: rest.map((block) =>
        block.type === "text"
          ? { type: "text" as const, text: block.text }
          : {
              type: "image_url" as const,
              image_url: { url: `data:${block.mediaType};base64,${block.data}` },
            },
      ),
    },
  ];
}

/** A single-message turn (text or images); see `toOpenAIMessages` for turns with tool results. */
export function toOpenAIMessage(message: ChatMessage): Param {
  return toOpenAIMessages(message)[0]!;
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

/** Tool-call arguments arrive as a JSON string; anything unparseable is passed on for the caller to reject. */
function parseArguments(json: string): unknown {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/** The longest end of `text` that could be the start of one of `tags`. */
function partialTag(text: string, tags: string[]): string {
  const longest = Math.min(text.length, Math.max(...tags.map((tag) => tag.length)) - 1);
  for (let length = longest; length > 0; length--) {
    const tail = text.slice(-length);
    if (tags.some((tag) => tag.startsWith(tail))) return tail;
  }
  return "";
}

/**
 * Some servers pass a reasoning model's thinking through in the reply text, wrapped in
 * <think>…</think> (others send it separately, or not at all). It is never part of the reply: this
 * removes those spans from streamed text, and a closing tag left on its own. Text that could be the
 * start of a tag is held back until it can be decided.
 */
export class ThinkFilter {
  private buffer = "";
  private thinking = false;

  /**
   * Adds streamed text; returns the text that is part of the reply. `reset` is set when a closing
   * tag turned up with no opening one: everything given out before it was thinking too.
   */
  push(chunk: string): { text: string; reset: boolean } {
    this.buffer += chunk;
    let reply = "";
    let reset = false;
    for (;;) {
      if (this.thinking) {
        const end = this.buffer.indexOf(THINK_CLOSE);
        if (end < 0) {
          this.buffer = partialTag(this.buffer, [THINK_CLOSE]);
          return { text: reply, reset };
        }
        this.buffer = this.buffer.slice(end + THINK_CLOSE.length);
        this.thinking = false;
        continue;
      }
      const tag = /<\/?think>/.exec(this.buffer);
      if (!tag) {
        const held = partialTag(this.buffer, [THINK_OPEN, THINK_CLOSE]);
        reply += this.buffer.slice(0, this.buffer.length - held.length);
        this.buffer = held;
        return { text: reply, reset };
      }
      if (tag[0] === THINK_OPEN) {
        reply += this.buffer.slice(0, tag.index);
        this.thinking = true;
      } else {
        reply = "";
        reset = true;
      }
      this.buffer = this.buffer.slice(tag.index + tag[0].length);
    }
  }

  /** End of the stream: what is held back was not a tag (unless the thinking never ended). */
  flush(): string {
    const rest = this.thinking ? "" : this.buffer;
    this.buffer = "";
    return rest;
  }
}

/**
 * Any OpenAI-compatible Chat Completions endpoint: OpenRouter, OpenAI, Azure OpenAI (v1 endpoint),
 * Groq, Mistral, Together, Ollama, vLLM, LM Studio.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly visionModels: Set<string>;
  private readonly toolModels: Set<string>;

  /**
   * `visionModels` / `toolModels`: models known to accept images / to call tools ("*" for all).
   * Endpoints and models differ, so by default none are assumed to: image requests skip this
   * provider, and requests are sent to it without tools.
   */
  constructor(
    readonly id: string,
    options: {
      apiKey: string;
      baseURL: string;
      headers?: Record<string, string>;
      visionModels?: string[];
      toolModels?: string[];
    },
  ) {
    this.visionModels = new Set(options.visionModels ?? []);
    this.toolModels = new Set(options.toolModels ?? []);
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      defaultHeaders: options.headers,
    });
  }

  supportsImages(model: string): boolean {
    return this.visionModels.has("*") || this.visionModels.has(model);
  }

  supportsTools(model: string): boolean {
    return this.toolModels.has("*") || this.toolModels.has(model);
  }

  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    const stream = await this.client.chat.completions.create(
      {
        model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: request.maxTokens ?? 4000,
        messages: [
          { role: "system", content: request.system.map((b) => b.text).join("\n\n") },
          ...request.messages.flatMap(toOpenAIMessages),
        ],
        ...(request.tools?.length ? { tools: toOpenAITools(request.tools) } : {}),
      },
      { signal: request.signal },
    );

    const usage = emptyUsage();
    let finish: string | null = null;
    let servedModel = model;
    let text = "";
    const thinking = new ThinkFilter();
    // Tool calls arrive in fragments keyed by index: the id and name first, then pieces of the arguments.
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      servedModel = chunk.model || servedModel;
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        const reply = thinking.push(choice.delta.content);
        if (reply.reset && text) {
          text = "";
          yield { type: "reset" };
        }
        if (reply.text) {
          text += reply.text;
          yield { type: "text", text: reply.text };
        }
      }
      for (const part of choice?.delta?.tool_calls ?? []) {
        const call = calls.get(part.index) ?? { id: "", name: "", args: "" };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.args += part.function.arguments;
        calls.set(part.index, call);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens = chunk.usage.completion_tokens ?? 0;
        usage.cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
    }

    const held = thinking.flush();
    if (held) {
      text += held;
      yield { type: "text", text: held };
    }

    const content: ContentBlock[] = text ? [{ type: "text", text }] : [];
    for (const [index, call] of [...calls].sort(([a], [b]) => a - b)) {
      if (!call.name) continue;
      // Some local servers leave the id out; any id unique within the turn works.
      content.push({
        type: "tool_call",
        id: call.id || `call_${index}`,
        name: call.name,
        input: parseArguments(call.args),
      });
    }
    const calledTools = content.some((b) => b.type === "tool_call");

    // A cut-off or filtered reply never runs its tools. Otherwise tool calls mean "tool_use", whatever
    // finish reason the server reports (some report "stop").
    const stopReason: StopReason =
      finish === "length"
        ? "max_tokens"
        : finish === "content_filter"
          ? "refusal"
          : calledTools
            ? "tool_use"
            : "end";
    yield { type: "done", model: servedModel, stopReason, usage, message: { role: "assistant", content } };
  }
}
