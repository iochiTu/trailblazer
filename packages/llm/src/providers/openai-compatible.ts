import OpenAI from "openai";
import type { ChatEvent, ChatMessage, ChatRequest, LLMProvider, StopReason } from "../types.js";
import { emptyUsage } from "../types.js";

/** Maps a provider-neutral message to Chat Completions (images as `data:` URLs). */
export function toOpenAIMessage(message: ChatMessage): OpenAI.Chat.ChatCompletionMessageParam {
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  if (message.role === "assistant") {
    // Assistant turns are text only.
    return {
      role: "assistant",
      content: message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n"),
    };
  }
  return {
    role: "user",
    content: message.content.map((block) =>
      block.type === "text"
        ? { type: "text" as const, text: block.text }
        : { type: "image_url" as const, image_url: { url: `data:${block.mediaType};base64,${block.data}` } },
    ),
  };
}

/**
 * Any OpenAI-compatible Chat Completions endpoint: OpenRouter, OpenAI, Azure OpenAI (v1 endpoint),
 * Groq, Mistral, Together, Ollama, vLLM, LM Studio.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly visionModels: Set<string>;

  /**
   * `visionModels`: models known to accept images ("*" for all). Endpoints differ, so by default
   * none are assumed to, and image requests skip this provider.
   */
  constructor(
    readonly id: string,
    options: { apiKey: string; baseURL: string; headers?: Record<string, string>; visionModels?: string[] },
  ) {
    this.visionModels = new Set(options.visionModels ?? []);
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      defaultHeaders: options.headers,
    });
  }

  supportsImages(model: string): boolean {
    return this.visionModels.has("*") || this.visionModels.has(model);
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
          ...request.messages.map(toOpenAIMessage),
        ],
      },
      { signal: request.signal },
    );

    const usage = emptyUsage();
    let finish: string | null = null;
    let servedModel = model;
    for await (const chunk of stream) {
      servedModel = chunk.model || servedModel;
      const choice = chunk.choices[0];
      const text = choice?.delta?.content;
      if (text) yield { type: "text", text };
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens = chunk.usage.completion_tokens ?? 0;
        usage.cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
    }

    const stopReason: StopReason =
      finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end";
    yield { type: "done", model: servedModel, stopReason, usage };
  }
}
