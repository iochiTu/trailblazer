# Owner agent ("Update by chat")

The onboarding chat (`/welcome`) asks a new owner a fixed set of questions. **Update by chat** is the same
conversation on an assistant's page, with an agent behind it: the owner says what changed in their own
words ("we're open Saturdays 10 to 2", "closed Dec 25–26", "parking is behind the shop"), and the agent
reads and changes the business's information with tools, then says what it changed.

```
portal  AgentTab ──POST /v1/tenants/:t/bots/:b/agent──▶ routes/agent.ts
          │  (conversation kept in the browser)               │ runAgent("owner")
          ▼                                                   ▼
        ChatThread (shared with /welcome)           packages/core/src/agent  ── LLMGateway ("agent" routes)
                                                              │ tool calls
                                                              ▼
                                                    apps/api/src/agent/*  (toolkits)
                                                    business · interview · answers · notices
```

## Pieces

| Piece | Where | What it is |
| --- | --- | --- |
| `AgentTool` | `packages/core/src/agent/types.ts` | One action. Zod input (validated before `run`, shown to the model as JSON Schema), `effect: "read" \| "write"`, returns text for the model and the `changes` it made. |
| `Toolkit` | same | A named group of tools about one area, with instructions for using them. **The unit you plug in.** |
| `AgentSpec` | same | An agent: instructions, the toolkits it may use, and the agents it may ask (`delegates`). |
| `AgentRegistry` | `packages/core/src/agent/registry.ts` | Where toolkits and agents are registered. Checks ids, unknown toolkits/agents, clashing tool names and schemas at start-up. |
| `runAgent` | `packages/core/src/agent/run.ts` | One turn: model → tools → results → model, until it answers (8 rounds max). Tool failures become error results; only a model failure throws. Write tools run one at a time, in order. |
| Owner toolkits | `apps/api/src/agent/` | `business` (details, weekly hours), `interview` (setup answers), `answers` (Q&A pairs), `notices` (closures). They call the same code as the portal's forms (e.g. `lib/interview.ts`) and audit with `via: "agent"`. |
| Route | `apps/api/src/routes/agent.ts` | Editors and up, 20 messages/min, records `llm.agent` usage (`task: "owner_agent"`). 503 `agent_unavailable` when no `agent` route can call tools. |
| UI | `apps/admin/src/components/bot/AgentTab.tsx`, `components/chat/ChatThread.tsx` | The tab, and the chat view it shares with the onboarding chat. |

The model only chooses tools and their input. Which business and assistant a tool acts on comes from
`AgentContext` (the signed-in person's), and every owner tool runs inside `inScope()` (RLS + the
assistant exists).

## Adding a toolkit

1. Write it next to the others in `apps/api/src/agent/` (or in a package when it isn't API-specific):

   ```ts
   export const photosToolkit: Toolkit = {
     id: "photos",
     title: "Business photos",
     instructions: "…how to use these tools well…",
     tools: [
       defineAgentTool({
         name: "list_photos",
         description: "…written for the model…",
         input: z.object({}),
         effect: "read",
         run: async (_input, ctx) => ({ content: json(await inScope(ctx, (tx) => …)) }),
       }),
     ],
   };
   ```

2. Register it in `ownerAgents()` (`apps/api/src/agent/owner.ts`) and add its id to the agent's `toolkits`.
3. Give the portal a line for its changes: `agent.done.<id>` in `packages/i18n` and `AREA_DONE` in `AgentTab.tsx`.
4. Test it with a scripted model (see `apps/api/src/agent.test.ts`).

Reuse the route's logic rather than writing to tables again: move it into `apps/api/src/lib/` and call it
from both (as `saveInterview` is).

## Other agents and their tools

An agent can hand a task to another agent: list it in `delegates` and it gets an `ask_<id>` tool. The other
agent runs with its own instructions and toolkits; its answer comes back as the tool result, and its
changes and usage are added to the turn. Depth is limited (`AGENT_LIMITS.depth`).

```ts
registry
  .addToolkit(catalogToolkit)
  .addAgent({ id: "catalog", name: "Catalog", description: "Adds and edits services and prices.",
              instructions: "…", toolkits: ["catalog"] })
  .addAgent({ ...ownerAgentSpec, delegates: ["catalog"] });
```

Outside tools (an MCP server, a CRM) fit the same shape: a toolkit whose tools call the outside service.
A small adapter that lists an MCP server's tools and wraps each as an `AgentTool` is the planned way in.

## Not done yet

- Replies arrive whole (no streaming); the portal shows "Working on it…" meanwhile.
- The conversation lives in the browser only. Nothing of it is stored on the server, so another device
  starts fresh.
- If the model fails partway through a turn, changes already saved stay saved, but the reply is an error.
  The audit log has every change (`via: "agent"`).
- No confirm-before-write step in the UI: the agent applies clear requests directly and is told to ask
  before removing anything.
