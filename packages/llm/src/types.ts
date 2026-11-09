/** Provider-neutral chat types used by the conversation engine. */

/** Image types every vision provider accepts. */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export type ContentBlock =
  | { type: "text"; text: string }
  /** Base64-encoded image (no `data:` prefix). */
  | { type: "image"; mediaType: ImageMediaType; data: string };

export interface ChatMessage {
  role: "user" | "assistant";
  /** Plain text, or blocks when the message carries images. */
  content: string | ContentBlock[];
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

export type StopReason = "end" | "max_tokens" | "refusal";

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "done"; usage: Usage; stopReason: StopReason; model: string };

export interface LLMProvider {
  readonly id: string;
  stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent>;
  /** Whether this model accepts image blocks. Requests with images skip routes that don't. */
  supportsImages(model: string): boolean;
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
