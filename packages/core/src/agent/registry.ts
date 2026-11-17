import { type AgentSpec, type AnyAgentTool, agentToolDefinition, type Toolkit } from "./types.js";

const ID = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * The toolkits and agents an app offers. Built once at start-up: each area registers its toolkit,
 * then the agents that use them. Registering checks ids and that an agent only names toolkits and
 * agents that exist, so a mistake fails at start-up rather than in a conversation.
 */
export class AgentRegistry {
  private readonly toolkits = new Map<string, Toolkit>();
  private readonly agents = new Map<string, AgentSpec>();

  addToolkit(toolkit: Toolkit): this {
    if (!ID.test(toolkit.id)) throw new Error(`Agent registry: bad toolkit id "${toolkit.id}"`);
    if (this.toolkits.has(toolkit.id)) throw new Error(`Agent registry: toolkit "${toolkit.id}" twice`);
    const names = new Set<string>();
    for (const tool of toolkit.tools) {
      if (!ID.test(tool.name)) throw new Error(`Agent registry: bad tool name "${tool.name}"`);
      if (tool.name.startsWith("ask_")) throw new Error(`Agent registry: "ask_" is kept for agents`);
      if (names.has(tool.name)) throw new Error(`Agent registry: tool "${tool.name}" twice`);
      names.add(tool.name);
      // A schema the model can't be shown fails here, at start-up, not in a conversation.
      try {
        agentToolDefinition(tool);
      } catch (error) {
        throw new Error(`Agent registry: tool "${tool.name}" has no JSON Schema (${String(error)})`);
      }
    }
    this.toolkits.set(toolkit.id, toolkit);
    return this;
  }

  /** Registers an agent; its toolkits and delegates must already be registered. */
  addAgent(spec: AgentSpec): this {
    if (!ID.test(spec.id)) throw new Error(`Agent registry: bad agent id "${spec.id}"`);
    if (this.agents.has(spec.id)) throw new Error(`Agent registry: agent "${spec.id}" twice`);
    for (const id of spec.toolkits) {
      if (!this.toolkits.has(id))
        throw new Error(`Agent registry: "${spec.id}" uses unknown toolkit "${id}"`);
    }
    for (const id of spec.delegates ?? []) {
      if (!this.agents.has(id)) throw new Error(`Agent registry: "${spec.id}" asks unknown agent "${id}"`);
    }
    // Two toolkits of one agent can't both have a tool of the same name.
    const seen = new Map<string, string>();
    for (const toolkit of this.toolkitsOf(spec)) {
      for (const tool of toolkit.tools) {
        const other = seen.get(tool.name);
        if (other) {
          throw new Error(
            `Agent registry: "${spec.id}" has "${tool.name}" in "${other}" and "${toolkit.id}"`,
          );
        }
        seen.set(tool.name, toolkit.id);
      }
    }
    this.agents.set(spec.id, spec);
    return this;
  }

  agent(id: string): AgentSpec {
    const spec = this.agents.get(id);
    if (!spec) throw new Error(`Agent registry: no agent "${id}"`);
    return spec;
  }

  hasAgent(id: string): boolean {
    return this.agents.has(id);
  }

  toolkit(id: string): Toolkit {
    const toolkit = this.toolkits.get(id);
    if (!toolkit) throw new Error(`Agent registry: no toolkit "${id}"`);
    return toolkit;
  }

  toolkitsOf(spec: AgentSpec): Toolkit[] {
    return spec.toolkits.map((id) => this.toolkit(id));
  }

  /** The agent's own tools (from its toolkits), with the toolkit each belongs to. */
  toolsOf(spec: AgentSpec): { tool: AnyAgentTool; toolkit: Toolkit }[] {
    return this.toolkitsOf(spec).flatMap((toolkit) => toolkit.tools.map((tool) => ({ tool, toolkit })));
  }

  /** Every registered agent (e.g. for a list of what the app can do). */
  listAgents(): AgentSpec[] {
    return [...this.agents.values()];
  }
}
