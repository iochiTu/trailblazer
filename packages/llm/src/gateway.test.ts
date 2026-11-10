import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createGatewayFromEnv } from "./config.js";
import { LLMGateway, parseRoutes } from "./gateway.js";
import { costMicros } from "./pricing.js";
import { AnthropicProvider, toAnthropicMessage } from "./providers/anthropic.js";
import { OfflineProvider } from "./providers/offline.js";
import {
  OpenAICompatibleProvider,
  ThinkFilter,
  toOpenAIMessage,
  toOpenAIMessages,
} from "./providers/openai-compatible.js";
import {
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type LLMProvider,
  type ToolDefinition,
  textOf,
  toolCallsOf,
} from "./types.js";

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

  it("sends owner-side jobs to the chat routes unless they have their own", async () => {
    const shared = createGatewayFromEnv({ ANTHROPIC_API_KEY: "test" }).gateway;
    expect(shared.routes("agent")).toEqual(shared.routes("chat"));

    const own = createGatewayFromEnv({
      ANTHROPIC_API_KEY: "test",
      LLM_AGENT_ROUTES: "anthropic:claude-sonnet-5-5",
    });
    expect(own.gateway.routes("agent")).toEqual([{ provider: "anthropic", model: "claude-sonnet-5-5" }]);
    expect(own.gateway.routes("chat")).toEqual([{ provider: "anthropic", model: "claude-opus-5-5" }]);
    expect(() => createGatewayFromEnv({ LLM_AGENT_ROUTES: "nowhere:m1" })).toThrow(/unknown provider/);

    const offline = createGatewayFromEnv({}).gateway;
    expect((await offline.complete("agent", request("hello"))).provider).toBe("offline");
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

const searchTool: ToolDefinition = {
  name: "search_knowledge",
  description: "Search the business's information.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
};
const toolTurn: ChatMessage[] = [
  { role: "user", content: "Do you have pie?" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "One moment." },
      { type: "tool_call", id: "call_1", name: "search_knowledge", input: { query: "pie" } },
    ],
  },
  { role: "user", content: [{ type: "tool_result", toolCallId: "call_1", content: "Blueberry pie daily." }] },
];

/** Records the requests it gets; calls tools when `tools` is true. */
class RecordingProvider implements LLMProvider {
  requests: ChatRequest[] = [];
  constructor(
    readonly id: string,
    private readonly tools: boolean,
  ) {}
  supportsImages() {
    return false;
  }
  supportsTools() {
    return this.tools;
  }
  async *stream(model: string, req: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push(req);
    yield { type: "text", text: this.id };
    yield {
      type: "done",
      model,
      stopReason: "end",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      message: { role: "assistant", content: [{ type: "text", text: this.id }] },
    };
  }
}

/** A local HTTP server that answers every POST with the given server-sent events. */
async function sseServer(events: (body: unknown) => string[]) {
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(events(body).join(""));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bodies,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function run(provider: LLMProvider, req: ChatRequest, model = "m1") {
  let text = "";
  let done: Extract<ChatEvent, { type: "done" }> | undefined;
  for await (const event of provider.stream(model, req)) {
    if (event.type === "text") text += event.text;
    else if (event.type === "reset") text = "";
    else done = event;
  }
  return { text, done: done! };
}

describe("tool calling", () => {
  const routes = (...chat: string[]) => ({
    chat: chat.map((provider) => ({ provider, model: "m1" })),
    aux: [{ provider: "offline", model: "echo" }],
  });

  it("gives tools only to models that can call them", async () => {
    const plain = new RecordingProvider("plain", false);
    const capable = new RecordingProvider("capable", true);
    const req: ChatRequest = { system: [], messages: [{ role: "user", content: "hi" }], tools: [searchTool] };

    const first = new LLMGateway({
      providers: [plain, capable, new OfflineProvider()],
      routes: routes("plain"),
    });
    expect(first.supportsTools("chat")).toBe(false);
    expect((await collect(first, req)).text).toBe("plain");
    expect(plain.requests[0]!.tools).toBeUndefined();
    expect(plain.requests[0]!.messages).toBe(req.messages);

    const second = new LLMGateway({
      providers: [plain, capable, new OfflineProvider()],
      routes: routes("capable"),
    });
    expect(second.supportsTools("chat")).toBe(true);
    const { done } = await collect(second, req);
    expect(capable.requests[0]!.tools).toEqual([searchTool]);
    expect(done).toMatchObject({ message: { role: "assistant" } });
  });

  it("continues a tool loop only on models that can call tools", async () => {
    const plain = new RecordingProvider("plain", false);
    const capable = new RecordingProvider("capable", true);
    const req: ChatRequest = { system: [], messages: toolTurn, tools: [searchTool] };
    const mixed = new LLMGateway({
      providers: [plain, capable, new OfflineProvider()],
      routes: routes("plain", "capable"),
    });
    expect((await collect(mixed, req)).text).toBe("capable");
    expect(plain.requests).toHaveLength(0);

    const none = new LLMGateway({ providers: [plain, new OfflineProvider()], routes: routes("plain") });
    await expect(collect(none, req)).rejects.toThrow(/can call tools/);
  });

  it("maps tool calls and results to Anthropic blocks, replaying its own turns as they were", () => {
    expect(toAnthropicMessage(toolTurn[1]!)).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "One moment." },
        { type: "tool_use", id: "call_1", name: "search_knowledge", input: { query: "pie" } },
      ],
    });
    expect(toAnthropicMessage(toolTurn[2]!)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1", content: "Blueberry pie daily." }],
    });
    expect(
      toAnthropicMessage({
        role: "user",
        content: [{ type: "tool_result", toolCallId: "call_1", content: "nope", isError: true }],
      }).content,
    ).toEqual([{ type: "tool_result", tool_use_id: "call_1", content: "nope", is_error: true }]);

    // Its own earlier turn goes back unchanged (reasoning included), but only to the same model.
    const raw = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "call_1", name: "search_knowledge", input: { query: "pie" } },
    ];
    const own: ChatMessage = {
      ...toolTurn[1]!,
      replay: { provider: "anthropic", model: "claude-opus-5-5", content: raw },
    };
    expect(toAnthropicMessage(own, "claude-opus-5-5").content).toBe(raw);
    expect(toAnthropicMessage(own, "claude-haiku-5-5")).toEqual(toAnthropicMessage(toolTurn[1]!));
    expect(
      toAnthropicMessage({ ...own, replay: { ...own.replay!, provider: "other" } }, "claude-opus-5-5"),
    ).toEqual(toAnthropicMessage(toolTurn[1]!));
  });

  it("maps tool calls and results to OpenAI messages", () => {
    expect(toolTurn.flatMap(toOpenAIMessages)).toEqual([
      { role: "user", content: "Do you have pie?" },
      {
        role: "assistant",
        content: "One moment.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "search_knowledge", arguments: '{"query":"pie"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "Blueberry pie daily." },
    ]);
  });

  it("reads streamed tool calls from an OpenAI-compatible endpoint", async () => {
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", model: "served", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const server = await sseServer(() => [
      chunk({ role: "assistant", content: "One " }),
      chunk({ content: "moment." }),
      // Two calls, each split across chunks; the second has no id (some local servers omit it).
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_a",
            type: "function",
            function: { name: "search_knowledge", arguments: '{"que' },
          },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'ry":"pie"}' } }] }),
      chunk({
        tool_calls: [
          { index: 1, type: "function", function: { name: "search_knowledge", arguments: "{broken" } },
        ],
      }),
      // Reported as "stop" by some servers even though tools were called.
      chunk({}, "stop"),
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", model: "served", choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    try {
      const provider = new OpenAICompatibleProvider("local", {
        apiKey: "x",
        baseURL: server.url,
        toolModels: ["m1"],
      });
      expect(provider.supportsTools("m1")).toBe(true);
      expect(provider.supportsTools("m2")).toBe(false);
      const { text, done } = await run(provider, { system: [], messages: toolTurn, tools: [searchTool] });
      expect(text).toBe("One moment.");
      expect(done).toMatchObject({ stopReason: "tool_use", usage: { inputTokens: 12, outputTokens: 7 } });
      expect(toolCallsOf(done.message)).toEqual([
        { type: "tool_call", id: "call_a", name: "search_knowledge", input: { query: "pie" } },
        // Arguments that aren't JSON are passed on as they came, for the caller to reject.
        { type: "tool_call", id: "call_1", name: "search_knowledge", input: "{broken" },
      ]);
      expect(server.bodies[0]).toMatchObject({
        tools: [
          { type: "function", function: { name: "search_knowledge", parameters: searchTool.inputSchema } },
        ],
        messages: [
          { role: "system" },
          { role: "user" },
          { role: "assistant" },
          { role: "tool", tool_call_id: "call_1" },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("keeps a model's thinking out of the reply text", async () => {
    const filter = (chunks: string[]) => {
      const thinking = new ThinkFilter();
      let text = "";
      for (const chunk of chunks) {
        const reply = thinking.push(chunk);
        text = (reply.reset ? "" : text) + reply.text;
      }
      return text + thinking.flush();
    };
    // Tags split across chunks; a closing tag on its own; text that only looks like a tag.
    expect(filter(["<thi", "nk>The visitor asks", " about pie.</th", "ink>\n\nYes, daily."])).toBe(
      "\n\nYes, daily.",
    );
    // A closing tag with no opening one: what came before it was thinking as well.
    expect(filter(["We open at 7.\n</think>", "\n\nWe open at 7 am."])).toBe("\n\nWe open at 7 am.");
    expect(filter(["Pies are <", "$20 and 3 < 5", " <t"])).toBe("Pies are <$20 and 3 < 5 <t");
    expect(filter(["Hello <think>never closed"])).toBe("Hello ");

    const chunk = (content: string, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", model: "served", choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`;
    const server = await sseServer(() => [
      chunk("<think>Let me"),
      chunk(" check.</thi"),
      chunk("nk>We close at two."),
      chunk("</think>We close "),
      chunk("at 2 pm.", "stop"),
      "data: [DONE]\n\n",
    ]);
    try {
      const provider = new OpenAICompatibleProvider("local", { apiKey: "x", baseURL: server.url });
      const { text, done } = await run(provider, { system: [], messages: [{ role: "user", content: "Hi" }] });
      expect(text).toBe("We close at 2 pm.");
      expect(done.message).toEqual({
        role: "assistant",
        content: [{ type: "text", text: "We close at 2 pm." }],
      });
    } finally {
      await server.close();
    }
  });

  it("reads streamed tool calls from Claude and sends its turn back unchanged", async () => {
    const sse = (type: string, data: object) =>
      `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const server = await sseServer(() => [
      sse("message_start", {
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 30, output_tokens: 1 },
        },
      }),
      sse("content_block_start", {
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      }),
      sse("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig" } }),
      sse("content_block_stop", { index: 0 }),
      sse("content_block_start", { index: 1, content_block: { type: "text", text: "" } }),
      sse("content_block_delta", { index: 1, delta: { type: "text_delta", text: "One moment." } }),
      sse("content_block_stop", { index: 1 }),
      sse("content_block_start", {
        index: 2,
        content_block: { type: "tool_use", id: "toolu_1", name: "search_knowledge", input: {} },
      }),
      sse("content_block_delta", {
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"query":' },
      }),
      sse("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: ' "pie"}' } }),
      sse("content_block_stop", { index: 2 }),
      sse("message_delta", {
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 25 },
      }),
      sse("message_stop", {}),
    ]);
    try {
      const provider = new AnthropicProvider({ apiKey: "test", baseURL: server.url });
      const base = { system: [{ text: "rules" }], tools: [searchTool] };
      const { text, done } = await run(provider, { ...base, messages: [toolTurn[0]!] }, "claude-opus-5-5");
      expect(text).toBe("One moment.");
      expect(done).toMatchObject({ stopReason: "tool_use", usage: { inputTokens: 30, outputTokens: 25 } });
      expect(done.message!.content).toEqual([
        { type: "text", text: "One moment." },
        { type: "tool_call", id: "toolu_1", name: "search_knowledge", input: { query: "pie" } },
      ]);
      expect(server.bodies[0]).toMatchObject({
        tools: [{ name: "search_knowledge", input_schema: searchTool.inputSchema }],
        output_config: { effort: "low" },
      });

      // Next request: its own turn (thinking block included) and the tool result.
      const result: ChatMessage = {
        role: "user",
        content: [{ type: "tool_result", toolCallId: "toolu_1", content: "Blueberry pie daily." }],
      };
      await run(provider, { ...base, messages: [toolTurn[0]!, done.message!, result] }, "claude-opus-5-5");
      const sent = (server.bodies[1] as { messages: { role: string; content: { type: string }[] }[] })
        .messages;
      expect(sent[1]!.content.map((b) => b.type)).toEqual(["thinking", "text", "tool_use"]);
      expect(sent[2]).toEqual({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Blueberry pie daily." }],
      });
    } finally {
      await server.close();
    }
  });
});

describe("reasoning effort on OpenAI-compatible endpoints", () => {
  const reply = () => [
    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", model: "m1", choices: [{ index: 0, delta: { content: "Hi." }, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const ask: ChatRequest = { system: [], messages: [{ role: "user", content: "Hi" }] };

  it("is sent only when set, in the field the endpoint reads", async () => {
    const server = await sseServer(reply);
    try {
      const options = { apiKey: "x", baseURL: server.url };
      await run(new OpenAICompatibleProvider("plain", options), ask);
      await run(new OpenAICompatibleProvider("local", { ...options, reasoningEffort: "none" }), ask);
      await run(
        new OpenAICompatibleProvider("router", {
          ...options,
          reasoningEffort: "low",
          reasoningField: "reasoning",
        }),
        ask,
      );
      const [plain, local, router] = server.bodies as Record<string, unknown>[];
      expect(plain).not.toHaveProperty("reasoning_effort");
      expect(plain).not.toHaveProperty("reasoning");
      expect(local).toMatchObject({ reasoning_effort: "none" });
      expect(local).not.toHaveProperty("reasoning");
      expect(router).toMatchObject({ reasoning: { effort: "low" } });
      expect(router).not.toHaveProperty("reasoning_effort");
    } finally {
      await server.close();
    }
  });

  it("comes from the environment, and a value that isn't one stops startup", async () => {
    const server = await sseServer(reply);
    try {
      const { gateway } = createGatewayFromEnv({
        OPENAI_COMPATIBLE_BASE_URL: server.url,
        OPENAI_COMPATIBLE_REASONING_EFFORT: " None ",
        LLM_CHAT_ROUTES: "openai-compatible:m1",
        LLM_AUX_ROUTES: "offline:echo",
      });
      await gateway.complete("chat", ask);
      expect(server.bodies[0]).toMatchObject({ reasoning_effort: "none" });
    } finally {
      await server.close();
    }
    expect(() =>
      createGatewayFromEnv({
        OPENAI_COMPATIBLE_BASE_URL: "http://localhost:1/v1",
        OPENAI_COMPATIBLE_REASONING_EFFORT: "off",
      }),
    ).toThrow(/OPENAI_COMPATIBLE_REASONING_EFFORT must be one of none, minimal/);
    expect(() =>
      createGatewayFromEnv({ OPENROUTER_API_KEY: "k", OPENROUTER_REASONING_EFFORT: "tiny" }),
    ).toThrow(/OPENROUTER_REASONING_EFFORT/);
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
    // 4000*4 + 400*20 + 1000*0.2 (this model's own cache-read rate) = 16000 + 8000 + 200
    expect(micros).toBe(24200);
    // A model without its own cache-read rate bills reads at 10 % of input: 1000 * 0.01.
    expect(
      costMicros(
        { provider: "anthropic", model: "claude-haiku-5-5" },
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1000, cacheWriteTokens: 0 },
      ),
    ).toBe(10);
    expect(
      costMicros(
        { provider: "offline", model: "x" },
        { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ),
    ).toBe(0);
  });
});
