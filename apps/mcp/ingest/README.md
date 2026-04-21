# @homehub/mcp-ingest

Secondary MCP server for ingest-side tools — push event, upsert entity, trigger re-enrichment. Kept separate from `mcp-homehub-core` so its trust boundary and network policy can be tighter (internal systems + tested provider integrations only).

- **Owner:** `@integrations`
- **Transport:** streamable-HTTP (served on Railway).
- **Milestone:** M4+.

## Current status

**M0 stub.** Server boots with `@modelcontextprotocol/sdk@^1.29.0`, serves the MCP handshake and `listTools` (returns `[]`), and exposes `/health` and `/ready`. Tool registration ships as each provider lands (`@integrations` in M4 onward).
