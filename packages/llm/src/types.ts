/** Provider-neutral chat types used by the conversation engine. */

/** Image types every vision provider accepts. */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export type ContentBlock =
  | { type: "text"; text: string }
  /** Base64-encoded image (no `data:` prefix). */
  | { type: "image"; mediaType: ImageMediaType; data: string }
  /** The model asks for a tool to be run (assistant messages only). `input` is unvalidated model output. */
  | { type: "tool_call"; id: string; name: string; input: unknown }
  /** What the tool returned, answering the `tool_call` with the same id (user messages only). */
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export type ToolCallBlock = Extract<ContentBlock, { type: "tool_call" }>;
export type ToolResultBlock = Extract<ContentBlock, { type: "tool_result" }>;

export interface ChatMessage {
  role: "user" | "assistant";
  /** Plain text, or blocks when the message carries images, tool calls or tool results. */
  content: string | ContentBlock[];
  /**
   * Set on assistant turns a provider produced during a tool loop: the provider's own content,
   * sent back as-is when the next request goes to the same provider and model (some models need
   * their reasoning blocks returned unchanged). Other routes use `content`.
   */
  replay?: { provider: string; model: string; content: unknown };
}

/** A tool the model may call. Tools are run by the caller (the chat engine), never by a provider. */
export interface ToolDefinition {
  name: string;
  /** What it does and when to use it, written for the model. */
  description: string;
  /** JSON Schema (an object schema) for the tool's input. */
  inputSchema: Record<string, unknown>;
}

/** The text of a message, ignoring images. */
export function textOf(content: ChatMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
}

export function hasImages(messages: ChatMessage[]): boolean {
  return messages.some((m) => typeof m.content !== "string" && m.content.some((b) => b.type === "image"));
}

/** True when the conversation already contains tool calls or results (a tool loop is under way). */
export function hasToolBlocks(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      typeof m.content !== "string" &&
      m.content.some((b) => b.type === "tool_call" || b.type === "tool_result"),
  );
}

/** The tool calls in a message, in order. */
export function toolCallsOf(message: ChatMessage | undefined): ToolCallBlock[] {
  return !message || typeof message.content === "string"
    ? []
    : message.content.filter((b): b is ToolCallBlock => b.type === "tool_call");
}

/**
 * System prompt split into blocks, stable content first. Blocks marked `cacheBreakpoint` end a
 * cacheable prefix (used by providers that support prompt caching; ignored by others).
 */
export interface SystemBlock {
  text: string;
  cacheBreakpoint?: boolean;
}

export type Effort = "low" | "medium" | "high";

export interface ChatRequest {
  system: SystemBlock[];
  messages: ChatMessage[];
  /** Tools the model may call. Routes whose model can't call tools get the request without them. */
  tools?: ToolDefinition[];
  maxTokens?: number;
  effort?: Effort;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** "tool_use": the model stopped to have tools run; run them and send the results back. */
export type StopReason = "end" | "max_tokens" | "refusal" | "tool_use";

export type ChatEvent =
  | { type: "text"; text: string }
  | {
      type: "done";
      usage: Usage;
      stopReason: StopReason;
      model: string;
      /**
       * The assistant turn (text and tool calls). Providers that support tools always set it; when
       * `stopReason` is "tool_use", append it and a user message with the tool results, then ask again.
       */
      message?: ChatMessage;
    };

export interface LLMProvider {
  readonly id: string;
  stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent>;
  /** Whether this model accepts image blocks. Requests with images skip routes that don't. */
  supportsImages(model: string): boolean;
  /** Whether this model can call tools (absent = no). */
  supportsTools?(model: string): boolean;
}

export interface ModelRoute {
  provider: string;
  model: string;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
