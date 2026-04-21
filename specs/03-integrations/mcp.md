# MCP (Model Context Protocol)

**Purpose.** MCP is the second integration surface, complementing Nango. It handles two things: (1) sources Nango doesn't cover, and (2) exposing HomeHub's own capabilities to background models and to any external Claude/ChatGPT the household wires up.

**Scope.** The MCP servers we operate, their tools/resources, and how they relate to the rest of the system.

## Why two integration surfaces?

- **Nango** is for classic third-party APIs with OAuth and standardized CRUD.
- **MCP** is for:
  - Sources without a stable third-party API (e.g., scraping a smart-home device's local API, or pulling a CSV the user drops in).
  - Exposing HomeHub's own capabilities (`write_meal`, `propose_suggestion`, `query_memory`) to any MCP-aware client — our background agents *and* the household's personal assistant of choice.

They overlap minimally. Where both are possible, prefer Nango for ingestion and keep MCP for capability-exposure.

## MCP servers we operate

### `mcp-homehub-core`
Exposes HomeHub capabilities to models. Tools:

- `query_memory(household_id, query, limit)` — semantic + graph search over the memory network.
- `list_events(household_id, start, end, segment?)` — unified calendar read.
- `propose_suggestion(household_id, segment, kind, payload, rationale)` — writes a `suggestion` row; does not execute.
- `draft_summary(household_id, segment, period, covered_start, covered_end)` — runs the summary pipeline and returns the result.
- `record_meal(household_id, planned_for, slot, dish, ...)` — writes to `app.meal`.
- `add_pantry_item(household_id, item...)` — writes to `app.pantry_item`.
- `append_to_person(household_id, person_id, note)` — writes to a person's memory doc.

Resources:

- `household://{id}/today` — today's digest.
- `household://{id}/person/{person_id}` — the person's canonical memory doc.
- `household://{id}/segment/{segment}/summary/{period}` — latest summary.

### `mcp-ingest`
Accepts ad-hoc ingestion: CSV uploads (bank exports), manual receipt photos, unstructured notes. Pushes them through the same normalize → persist → enrich pipeline.

### `mcp-local-devices`
Optional, per-household. Runs on the household's own network (or a Raspberry Pi) to pull data from smart-home devices that lack a cloud API. Talks back to the HomeHub core via an authenticated tunnel. Out of scope for v1 but the interface is designed to accept it.

## Authorization

- Every MCP server authenticates the caller.
- For background agents on Railway: shared service token, rotated, scoped per server.
- For a household member's external MCP client (e.g., Claude Desktop): a per-member MCP token that encodes `(user_id, allowed_scopes)`. Issued from the HomeHub settings UI; revokable.

## Why expose HomeHub over MCP to the household's own assistant?

Because many households already use Claude Desktop / ChatGPT / etc. as their daily driver. MCP lets them point that assistant at their own HomeHub and get context without us building another chat UI. The control panel is the household dashboard; MCP is the household data surface.

## Transport

- HTTP with streaming for long tools (e.g., `draft_summary`).
- WebSocket for tools that return progressive results.
- Hosted on Railway, one service per MCP server, fronted by a shared gateway that handles auth and rate-limiting.

## Dependencies

- [`nango.md`](./nango.md)
- [`../05-agents/model-routing.md`](../05-agents/model-routing.md)
- [`../04-memory-network/retrieval.md`](../04-memory-network/retrieval.md)

## Open questions

- How do we scope MCP tokens per segment? Leaning: token holds a list of `(segment, access)` tuples matching the member's grants.
- Rate limiting granularity — per token, per household, per tool? Likely all three, combined.
