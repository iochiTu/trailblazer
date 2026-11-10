import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentBlock,
  LLMProvider,
  StopReason,
  ToolDefinition,
} from "../types.js";

const PROVIDER_ID = "anthropic";

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-fable-5",
]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Maps a provider-neutral message to the Messages API shape (images as base64 image blocks, tool
 * calls and results as tool_use / tool_result blocks). An assistant turn this provider produced
 * with the same `model` is sent back exactly as it was returned, reasoning blocks included.
 */
export function toAnthropicMessage(message: ChatMessage, model?: string): Anthropic.Beta.BetaMessageParam {
  const { replay } = message;
  if (message.role === "assistant" && replay?.provider === PROVIDER_ID && replay.model === model) {
    return { role: "assistant", content: replay.content as Anthropic.Beta.BetaContentBlockParam[] };
  }
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  return { role: message.role, content: message.content.map(toAnthropicBlock) };
}

function toAnthropicBlock(block: ContentBlock): Anthropic.Beta.BetaContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      return { type: "image", source: { type: "base64", media_type: block.mediaType, data: block.data } };
    case "tool_call":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolCallId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      };
  }
}

/**
 * Tool definitions for the Messages API. Inputs are short (a search phrase, contact details), so
 * they are left on the API's default buffered, server-validated delivery rather than eager streaming.
 */
export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Beta.BetaTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool["input_schema"],
  }));
}

/** The provider-neutral view of a response: its text and tool calls (reasoning is not kept here). */
export function fromAnthropicContent(content: Anthropic.Beta.BetaContentBlock[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const block of content) {
    if (block.type === "text") blocks.push({ type: "text", text: block.text });
    else if (block.type === "tool_use") {
      blocks.push({ type: "tool_call", id: block.id, name: block.name, input: block.input });
    }
  }
  return blocks;
}

/** Claude through the official Anthropic SDK. */
export class AnthropicProvider implements LLMProvider {
  readonly id = PROVIDER_ID;
  private readonly client: Anthropic;

  constructor(options: { apiKey?: string; baseURL?: string } = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL });
  }

  /** Every current Claude model accepts images. */
  supportsImages(): boolean {
    return true;
  }

  /** Every current Claude model can call tools. */
  supportsTools(): boolean {
    return true;
  }

  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    // Stable blocks first; the block flagged as a cache breakpoint ends the cached prefix.
    const system: Anthropic.Beta.BetaTextBlockParam[] = request.system.map((block) => ({
      type: "text",
      text: block.text,
      ...(block.cacheBreakpoint ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    const useFallbacks = FALLBACK_MODELS.has(model);
    const stream = this.client.beta.messages.stream(
      {
        model,
        max_tokens: request.maxTokens ?? 16000,
        system,
        messages: request.messages.map((message) => toAnthropicMessage(message, model)),
        ...(request.tools?.length ? { tools: toAnthropicTools(request.tools) } : {}),
        // Thinking stays adaptive (the default); effort controls depth and cost.
        output_config: { effort: request.effort ?? "low" },
        ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      },
      { signal: request.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    const stopReason: StopReason =
      final.stop_reason === "refusal"
        ? "refusal"
        : final.stop_reason === "max_tokens"
          ? "max_tokens"
          : final.stop_reason === "tool_use"
            ? "tool_use"
            : "end";
    yield {
      type: "done",
      model: final.model,
      stopReason,
      message: {
        role: "assistant",
        content: fromAnthropicContent(final.content),
        // Keyed by the requested model: the reply may have been served by a fallback model.
        replay: { provider: PROVIDER_ID, model, content: final.content },
      },
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
