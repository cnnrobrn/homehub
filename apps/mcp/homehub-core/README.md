# @homehub/mcp-homehub-core

HomeHub's primary MCP (Model Context Protocol) server. Exposes the household-facing tool catalog — node lookup, entity search, memory queries, summary/alert/suggestion actions, and household-scoped executors — to the foreground conversation agent and any external MCP clients.

- **Owner:** `@integrations` (wires the tool catalog and their routing)
- **Implementations delivered by:** `@frontend-chat` (UI-adjacent tools), `@memory-background` (graph/retrieval tools)
- **Transport:** streamable-HTTP (served on Railway).
- **Milestone:** M3.

## Current status

**M0 stub.** Server boots with `@modelcontextprotocol/sdk@^1.29.0`, serves the MCP handshake and `listTools` (returns `[]` — zero tools registered), and exposes `/health` and `/ready`. All tool registration and handler wiring ships in M3.

See `specs/13-conversation/tools.md` for the planned tool catalog.
