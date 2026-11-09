import { describe, expect, it } from "vitest";
import { createGatewayFromEnv } from "./config.js";
import { LLMGateway, parseRoutes } from "./gateway.js";
import { costMicros } from "./pricing.js";
import { toAnthropicMessage } from "./providers/anthropic.js";
import { OfflineProvider } from "./providers/offline.js";
import { OpenAICompatibleProvider, toOpenAIMessage } from "./providers/openai-compatible.js";
import { type ChatEvent, type ChatMessage, type ChatRequest, type LLMProvider, textOf } from "./types.js";

class FailingProvider implements LLMProvider {
  readonly id = "failing";
  calls = 0;
  constructor(private readonly afterText = false) {}
  supportsImages() {
    return false;
  }
  async *stream(): AsyncIterable<ChatEvent> {
    this.calls++;
    if (this.afterText) yield { type: "text", text: "partial " };
    throw new Error("provider down");
  }
}

const request = (question: string, knowledge = ""): ChatRequest => ({
  // The rules mention the tag name too; the offline provider must read the last block.
  system: [
    { text: `Answer only from <knowledge>. Never use outside facts.\n<knowledge>${knowledge}</knowledge>` },
  ],
  messages: [{ role: "user", content: question }],
});

async function collect(gateway: LLMGateway, req: ChatRequest) {
  let text = "";
  let done: unknown;
  for await (const e of gateway.stream("chat", req)) {
    if (e.type === "text") text += e.text;
    else done = e;
  }
  return { text, done };
}

describe("LLM gateway", () => {
  it("parses routes", () => {
    expect(parseRoutes("anthropic:claude-opus-5-5, openrouter:vendor/model:free")).toEqual([
      { provider: "anthropic", model: "claude-opus-5-5" },
      { provider: "openrouter", model: "vendor/model:free" },
    ]);
    expect(() => parseRoutes("nocolon")).toThrow();
  });

  it("falls back to the next route when a provider fails before any text", async () => {
    const failing = new FailingProvider();
    const fallbacks: string[] = [];
    const gateway = new LLMGateway({
      providers: [failing, new OfflineProvider()],
      routes: {
        chat: [
          { provider: "failing", model: "x" },
          { provider: "offline", model: "knowledge" },
        ],
        aux: [{ provider: "offline", model: "echo" }],
      },
      onFallback: ({ to }) => fallbacks.push(to.provider),
    });
    const { text, done } = await collect(gateway, request("When do you open?", "We open at 9 am every day."));
    expect(failing.calls).toBe(1);
    expect(fallbacks).toEqual(["offline"]);
    expect(text).toContain("We open at 9 am every day.");
    expect(done).toMatchObject({ provider: "offline", stopReason: "end" });
  });

  it("does not switch providers after text has streamed", async () => {
    const gateway = new LLMGateway({
      providers: [new FailingProvider(true), new OfflineProvider()],
      routes: {
        chat: [
          { provider: "failing", model: "x" },
          { provider: "offline", model: "knowledge" },
        ],
        aux: [{ provider: "offline", model: "echo" }],
      },
    });
    await expect(collect(gateway, request("hi"))).rejects.toThrow("provider down");
  });

  it("rejects routes to unknown providers", () => {
    expect(
      () =>
        new LLMGateway({
          providers: [new OfflineProvider()],
          routes: { chat: [{ provider: "nope", model: "m" }], aux: [{ provider: "offline", model: "echo" }] },
        }),
    ).toThrow(/unknown provider/);
  });

  it("uses the offline provider when no keys are configured", async () => {
    const { gateway, offline } = createGatewayFromEnv({});
    expect(offline).toBe(true);
    const aux = await gateway.complete("aux", request("rewrite me"));
    expect(aux.text).toBe("rewrite me");
  });

  it("routes to Claude when an Anthropic key is present", () => {
    const { gateway, offline } = createGatewayFromEnv({ ANTHROPIC_API_KEY: "test" });
    expect(offline).toBe(false);
    expect(gateway.routes("chat")).toEqual([{ provider: "anthropic", model: "claude-opus-5-5" }]);
    expect(gateway.routes("aux")).toEqual([{ provider: "anthropic", model: "claude-haiku-5-5" }]);
  });
});

/** Records the last request; can see images. */
class VisionProvider implements LLMProvider {
  readonly id = "vision";
  last: ChatRequest | null = null;
  supportsImages() {
    return true;
  }
  async *stream(model: string, req: ChatRequest): AsyncIterable<ChatEvent> {
    this.last = req;
    yield { type: "text", text: "a red bicycle" };
    yield {
      type: "done",
      model,
      stopReason: "end",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const withImage: ChatMessage = {
  role: "user",
  content: [
    { type: "image", mediaType: "image/png", data: PIXEL },
    { type: "text", text: "What is this?" },
  ],
};

describe("image messages", () => {
  it("maps image blocks to Anthropic base64 image blocks", () => {
    expect(toAnthropicMessage(withImage)).toEqual({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL } },
        { type: "text", text: "What is this?" },
      ],
    });
    expect(toAnthropicMessage({ role: "assistant", content: "Hi" })).toEqual({
      role: "assistant",
      content: "Hi",
    });
  });

  it("maps image blocks to OpenAI data URLs", () => {
    expect(toOpenAIMessage(withImage)).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${PIXEL}` } },
        { type: "text", text: "What is this?" },
      ],
    });
    expect(toOpenAIMessage({ role: "user", content: "plain" })).toEqual({ role: "user", content: "plain" });
  });

  it("reads the text of block content", () => {
    expect(textOf(withImage.content)).toBe("What is this?");
    expect(textOf("plain")).toBe("plain");
  });

  it("sends image requests only to routes that accept images", async () => {
    const vision = new VisionProvider();
    const failing = new FailingProvider();
    const gateway = new LLMGateway({
      providers: [new OfflineProvider(), failing, vision],
      routes: {
        chat: [
          { provider: "offline", model: "knowledge" },
          { provider: "failing", model: "x" },
          { provider: "vision", model: "v1" },
        ],
        aux: [{ provider: "offline", model: "echo" }],
      },
    });
    expect(gateway.supportsImages("chat")).toBe(true);
    expect(gateway.supportsImages("aux")).toBe(false);

    const { text } = await collect(gateway, { system: [], messages: [withImage] });
    expect(text).toBe("a red bicycle");
    expect(failing.calls).toBe(0);
    expect(vision.last?.messages[0]).toBe(withImage);

    // Text-only requests keep the normal route order.
    const plain = await collect(gateway, request("hello", "Hello and welcome to our shop today."));
    expect(plain.text).toContain("[Offline test mode]");
  });

  it("refuses image requests when no route accepts images", async () => {
    const { gateway } = createGatewayFromEnv({});
    expect(gateway.supportsImages("chat")).toBe(false);
    await expect(collect(gateway, { system: [], messages: [withImage] })).rejects.toThrow(/accepts images/);
  });

  it("marks configured OpenAI-compatible models as vision-capable", () => {
    const provider = new OpenAICompatibleProvider("openrouter", {
      apiKey: "x",
      baseURL: "http://localhost",
      visionModels: ["vendor/vision"],
    });
    expect(provider.supportsImages("vendor/vision")).toBe(true);
    expect(provider.supportsImages("vendor/text")).toBe(false);
    const { gateway } = createGatewayFromEnv({
      OPENROUTER_API_KEY: "x",
      OPENROUTER_VISION_MODELS: "*",
      LLM_CHAT_ROUTES: "openrouter:any/model",
    });
    expect(gateway.supportsImages("chat")).toBe(true);
  });
});

describe("offline photos", () => {
  it("shows the photo that best matches the question", async () => {
    const { gateway } = createGatewayFromEnv({});
    const system = [
      {
        text: `<knowledge>\nThe patio is open in summer.\n</knowledge>\n\n<photos>\n<photo id="p1" title="Storefront">Our red door on Main Street</photo>\n<photo id="p2" title="Patio">Summer patio with 30 seats</photo>\n</photos>`,
      },
    ];
    const { text } = await collect(gateway, {
      system,
      messages: [{ role: "user", content: "Is the patio open?" }],
    });
    expect(text).toContain("[[photo:p2]]");
    const none = await collect(gateway, { system, messages: [{ role: "user", content: "Wifi password?" }] });
    expect(none.text).not.toContain("[[photo:");
  });
});

describe("pricing", () => {
  it("computes micro-USD including cache reads and writes", () => {
    const micros = costMicros(
      { provider: "anthropic", model: "claude-opus-5-5" },
      { inputTokens: 4000, outputTokens: 400, cacheReadTokens: 1000, cacheWriteTokens: 0 },
    );
    // 4000*4 + 400*20 + 1000*0.4 = 16000 + 8000 + 400
    expect(micros).toBe(24400);
    expect(
      costMicros(
        { provider: "offline", model: "x" },
        { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ),
    ).toBe(0);
  });
});
