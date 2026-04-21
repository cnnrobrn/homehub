# Conversation

**Purpose.** HomeHub's first-party conversational surface. This is how a member opens the app and types *"plan our meal tonight"* or *"what's happening this weekend?"* and gets a useful answer.

**Scope.** The chat UI, the foreground agent loop, the tools the agent can call, and how conversations become memory.

## Why a first-party chat

The control panel (suggestions, cards, approval flow) is the dashboard surface. It works great for browsing and approving. It does not work for the many household interactions that are fundamentally **asked**:

- "Plan our meal tonight."
- "Did we get milk on the last grocery run?"
- "When did we last have dinner with the Garcias?"
- "What do I owe Priya?"
- "What should we do this weekend?"

MCP already exposes HomeHub to the household's *external* assistants (Claude Desktop, etc.). That's valuable but optional — it assumes the household is in that ecosystem. The first-party chat is for everyone else, and it is where the memory system proves its value.

## Files in this directory

- [`overview.md`](./overview.md) — product shape of the chat surface.
- [`ui.md`](./ui.md) — the chat UI on Vercel.
- [`agent-loop.md`](./agent-loop.md) — what happens on each turn.
- [`tools.md`](./tools.md) — the tool catalog the agent can call.
- [`conversations-data-model.md`](./conversations-data-model.md) — how conversations are stored and become memory.

## Relationship to other specs

- Memory retrieval: [`../04-memory-network/retrieval.md`](../04-memory-network/retrieval.md).
- Approval flow (tool calls that need human tap): [`../05-agents/approval-flow.md`](../05-agents/approval-flow.md).
- Model routing: [`../05-agents/model-routing.md`](../05-agents/model-routing.md) — foreground tier.
- MCP (same capabilities, external surface): [`../03-integrations/mcp.md`](../03-integrations/mcp.md).
