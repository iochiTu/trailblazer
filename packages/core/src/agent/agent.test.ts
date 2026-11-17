import type { Db } from "@traiblazer/db";
import {
  type ChatEvent,
  type ChatRequest,
  type ContentBlock,
  LLMGateway,
  type LLMProvider,
  OfflineProvider,
  type ToolResultBlock,
} from "@traiblazer/llm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AGENT_LIMITS,
  type AgentContext,
  AgentRegistry,
  type AgentStep,
  defineAgentTool,
  runAgent,
  type Toolkit,
} from "./index.js";

interface ScriptedTurn {
  text?: string;
  calls?: { name: string; input: unknown }[];
}

/** A model that calls tools: each request gets the next turn the script returns for it. */
class ToolProvider implements LLMProvider {
  readonly id = "tools";
  requests: ChatRequest[] = [];
  constructor(private readonly script: (request: ChatRequest, call: number) => ScriptedTurn) {}
  supportsImages() {
    return false;
  }
  supportsTools() {
    return true;
  }
  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push({ ...request, messages: [...request.messages] });
    const call = this.requests.length;
    const turn = this.script(request, call);
    if (turn.text) yield { type: "text", text: turn.text };
    const content: ContentBlock[] = [
      ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
      ...(turn.calls ?? []).map((c, i) => ({ type: "tool_call" as const, id: `call_${call}_${i}`, ...c })),
    ];
    yield {
      type: "done",
      model,
      stopReason: turn.calls?.length ? "tool_use" : "end",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      message: { role: "assistant", content },
    };
  }
}

const gatewayFor = (provider: ToolProvider) =>
  new LLMGateway({
    providers: [provider, new OfflineProvider()],
    routes: {
      chat: [{ provider: "offline", model: "echo" }],
      aux: [{ provider: "offline", model: "echo" }],
      agent: [{ provider: "tools", model: "t1" }],
    },
  });

const results = (request: ChatRequest): ToolResultBlock[] => {
  const latest = request.messages.at(-1)!.content;
  return typeof latest === "string"
    ? []
    : latest.filter((b): b is ToolResultBlock => b.type === "tool_result");
};

const ctx: AgentContext = {
  db: {} as Db,
  tenantId: "t1",
  botId: "b1",
  userId: "u1",
  language: "en",
};

/** A tiny "hours" toolkit over an in-memory store. */
function hoursToolkit(store: { hours: Record<string, string> }): Toolkit {
  return {
    id: "hours",
    title: "Opening hours",
    instructions: "Read the hours before changing them.",
    tools: [
      defineAgentTool({
        name: "get_hours",
        description: "The opening hours.",
        input: z.object({}),
        effect: "read",
        run: async () => ({ content: JSON.stringify(store.hours) }),
      }),
      defineAgentTool({
        name: "set_hours",
        description: "Set one day's hours.",
        input: z.object({ day: z.enum(["mon", "sat"]), hours: z.string() }),
        effect: "write",
        run: async ({ day, hours }) => {
          store.hours[day] = hours;
          return { content: "Saved.", changes: [{ area: "hours", summary: `Hours set for ${day}` }] };
        },
      }),
      defineAgentTool({
        name: "explode",
        description: "Always fails.",
        input: z.object({}),
        effect: "write",
        run: async () => {
          throw new Error("boom");
        },
      }),
    ],
  };
}

const ownerAgent = {
  id: "owner",
  name: "Owner helper",
  description: "Keeps the business's information up to date.",
  instructions: "You help the owner.",
  toolkits: ["hours"],
};

describe("agent registry", () => {
  it("refuses unknown toolkits, unknown delegates and clashing tool names", () => {
    const registry = new AgentRegistry().addToolkit(hoursToolkit({ hours: {} }));
    expect(() => registry.addAgent({ ...ownerAgent, toolkits: ["nope"] })).toThrow(/unknown toolkit/);
    expect(() => registry.addAgent({ ...ownerAgent, delegates: ["ghost"] })).toThrow(/unknown agent/);
    expect(() => registry.addToolkit(hoursToolkit({ hours: {} }))).toThrow(/twice/);
    registry.addToolkit({ ...hoursToolkit({ hours: {} }), id: "hours_copy" });
    expect(() => registry.addAgent({ ...ownerAgent, toolkits: ["hours", "hours_copy"] })).toThrow(
      /"get_hours" in "hours" and "hours_copy"/,
    );
    expect(() =>
      new AgentRegistry().addToolkit({
        id: "x_kit",
        title: "x",
        tools: [{ ...hoursToolkit({ hours: {} }).tools[0]!, name: "ask_me" }],
      }),
    ).toThrow(/ask_/);
  });
});

describe("runAgent", () => {
  it("reads, writes, and answers with the changes it made", async () => {
    const store = { hours: { mon: "9-5" } as Record<string, string> };
    const provider = new ToolProvider((request, call) => {
      if (call === 1) return { text: "Let me look.", calls: [{ name: "get_hours", input: {} }] };
      if (call === 2) {
        expect(results(request)[0]!.content).toContain("9-5");
        return { calls: [{ name: "set_hours", input: { day: "sat", hours: "10-2" } }] };
      }
      return { text: "Saturday is now 10 to 2." };
    });
    const registry = new AgentRegistry().addToolkit(hoursToolkit(store)).addAgent(ownerAgent);
    const result = await runAgent(
      { gateway: gatewayFor(provider), registry },
      {
        agent: "owner",
        messages: [{ role: "user", content: "Open Saturdays 10 to 2" }],
        ctx,
        context: "Business: Maple Bakery",
      },
    );

    expect(store.hours.sat).toBe("10-2");
    expect(result.reply).toBe("Saturday is now 10 to 2.");
    expect(result.changes).toEqual([{ area: "hours", summary: "Hours set for sat" }]);
    expect(result.toolsUsed).toEqual(["get_hours", "set_hours"]);
    expect(result.usage).toMatchObject({ modelCalls: 3, inputTokens: 30, outputTokens: 15 });

    const system = provider.requests[0]!.system.map((b) => b.text).join("\n");
    expect(system).toContain("You help the owner.");
    expect(system).toContain("Business: Maple Bakery");
    expect(system).toContain(
      '<toolkit id="hours" title="Opening hours" tools="get_hours, set_hours, explode">',
    );
    expect(system).toContain("Read the hours before changing them.");
    expect(provider.requests[0]!.tools!.map((t) => t.name)).toEqual(["get_hours", "set_hours", "explode"]);
  });

  it("turns bad input, unknown tools and failures into errors the model reads", async () => {
    const store = { hours: {} as Record<string, string> };
    let seen: ToolResultBlock[] = [];
    const provider = new ToolProvider((request, call) => {
      if (call === 1) {
        return {
          calls: [
            { name: "set_hours", input: { day: "sun", hours: "x" } },
            { name: "no_such_tool", input: {} },
            { name: "explode", input: {} },
          ],
        };
      }
      seen = results(request);
      return { text: "Sorry, that didn't work." };
    });
    const registry = new AgentRegistry().addToolkit(hoursToolkit(store)).addAgent(ownerAgent);
    const result = await runAgent(
      { gateway: gatewayFor(provider), registry },
      { agent: "owner", messages: [{ role: "user", content: "Open Sunday" }], ctx },
    );

    expect(seen.map((r) => r.isError)).toEqual([true, true, true]);
    expect(seen[0]!.content).toContain("day");
    expect(seen[1]!.content).toContain('no tool named "no_such_tool"');
    expect(seen[2]!.content).toContain("failed");
    expect(store.hours).toEqual({});
    expect(result.changes).toEqual([]);
    expect(result.toolsUsed).toEqual([]);
    expect(result.reply).toBe("Sorry, that didn't work.");
  });

  it("stops calling tools after the last round and asks for an answer", async () => {
    const provider = new ToolProvider((request) => {
      const last = results(request).at(-1)?.content ?? "";
      return last.includes("No more tool calls")
        ? { text: "Here is what I found." }
        : { calls: [{ name: "get_hours", input: {} }] };
    });
    const registry = new AgentRegistry()
      .addToolkit(hoursToolkit({ hours: {} }))
      .addAgent({ ...ownerAgent, maxRounds: 2 });
    const result = await runAgent(
      { gateway: gatewayFor(provider), registry },
      { agent: "owner", messages: [{ role: "user", content: "Loop" }], ctx },
    );
    expect(provider.requests).toHaveLength(3);
    expect(result.reply).toBe("Here is what I found.");
  });

  it("hands a task to another agent, whose changes and usage come back", async () => {
    const store = { hours: {} as Record<string, string> };
    const provider = new ToolProvider((request) => {
      const system = request.system.map((b) => b.text).join("\n");
      const done = results(request).length > 0;
      if (system.includes("You only do hours.")) {
        return done
          ? { text: "Monday set." }
          : { calls: [{ name: "set_hours", input: { day: "mon", hours: "8-4" } }] };
      }
      return done
        ? { text: `The hours agent says: ${results(request)[0]!.content}` }
        : { calls: [{ name: "ask_hours_agent", input: { task: "Set Monday to 8-4" } }] };
    });
    const registry = new AgentRegistry()
      .addToolkit(hoursToolkit(store))
      .addToolkit({ id: "nothing", title: "Nothing", tools: [] })
      .addAgent({
        id: "hours_agent",
        name: "Hours",
        description: "Changes opening hours.",
        instructions: "You only do hours.",
        toolkits: ["hours"],
      })
      .addAgent({ ...ownerAgent, toolkits: ["nothing"], delegates: ["hours_agent"] });

    const steps: AgentStep[] = [];
    const result = await runAgent(
      { gateway: gatewayFor(provider), registry },
      {
        agent: "owner",
        messages: [{ role: "user", content: "Mondays 8 to 4" }],
        ctx,
        onStep: (step) => {
          steps.push(step);
          // A listener that fails doesn't stop the agent.
          throw new Error("listener broke");
        },
      },
    );

    // Each step as it starts, the asked agent's included (with its own id and depth).
    expect(steps).toEqual([
      { type: "thinking", agent: "owner", depth: 0, round: 0 },
      {
        type: "tool",
        agent: "owner",
        depth: 0,
        tool: "ask_hours_agent",
        toolkit: null,
        effect: "write",
        delegate: "hours_agent",
      },
      { type: "thinking", agent: "hours_agent", depth: 1, round: 0 },
      { type: "tool", agent: "hours_agent", depth: 1, tool: "set_hours", toolkit: "hours", effect: "write" },
      { type: "thinking", agent: "hours_agent", depth: 1, round: 1 },
      { type: "thinking", agent: "owner", depth: 0, round: 1 },
    ]);
    expect(provider.requests[0]!.tools!.map((t) => t.name)).toEqual(["ask_hours_agent"]);
    expect(provider.requests[0]!.system[0]!.text).toContain("ask_hours_agent: Changes opening hours.");
    expect(store.hours.mon).toBe("8-4");
    expect(result.reply).toBe("The hours agent says: Monday set.");
    expect(result.changes).toEqual([{ area: "hours", summary: "Hours set for mon" }]);
    // Two calls for the owner agent, two for the hours agent.
    expect(result.usage.modelCalls).toBe(4);
  });

  it("doesn't let agents ask agents past the depth limit", async () => {
    expect(AGENT_LIMITS.depth).toBe(2);
    const provider = new ToolProvider(() => ({ text: "ok" }));
    const registry = new AgentRegistry()
      .addToolkit({ id: "nothing", title: "Nothing", tools: [] })
      .addAgent({ ...ownerAgent, id: "leaf", toolkits: ["nothing"] })
      .addAgent({ ...ownerAgent, id: "middle", toolkits: ["nothing"], delegates: ["leaf"] });
    await runAgent(
      { gateway: gatewayFor(provider), registry },
      { agent: "middle", messages: [{ role: "user", content: "hi" }], ctx, depth: 1 },
    );
    expect(provider.requests[0]!.tools).toEqual([]);
  });
});
