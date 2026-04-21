# Conversation — UI

**Purpose.** The chat interface details.

**Scope.** Layout, streaming, tool-call rendering, memory trace, approval inline.

## Layout

### Full page (`/chat`)

- **Left sidebar:** conversation list (grouped by date). Each entry shows a 1-line title the model auto-titles after the first exchange.
- **Center column:** active conversation. Message list + composer at bottom.
- **Right panel (collapsible):** "context" — the facts and episodes the agent is currently relying on. Updates live as retrieval happens.

### Launcher (`⌘K` from anywhere)

- Floating panel anchored to the header.
- Single-composer + last-3-turn preview.
- "Expand" button opens the full page preserving the thread.

## Message rendering

Each message has:

- **Body** — markdown, streamed.
- **Tool cards** — inline, collapsed by default. Expanded view shows arguments and result. Click-through opens the referenced entity.
- **Memory citations** — small inline chips like `[Sarah]` or `[2026-04-12 dinner]` that link to their node / episode.
- **Confidence signal** — when the agent is relying on low-confidence or conflicting facts, a subtle "uncertain" badge appears near the relevant citation.

## Tool cards

Rendered per tool kind:

- `query_memory` → shows the query, the layer(s), and a compact list of retrieved nodes/facts with "open in graph" links.
- `list_events` → a small calendar strip.
- `propose_suggestion` → renders the suggestion card inline with Approve/Reject right there.
- `draft_meal_plan` → renders a mini-planner that the member can edit before saving.
- `create_fact` / `supersede_fact` → shows the before/after with "confirm" control.

## Streaming

- Model tokens stream in.
- Tool calls pause the text stream, show a spinner card, then insert the card and resume.
- The member can interject mid-stream with "stop" — the agent finishes the current tool call and exits cleanly.

## Inline approval

Any tool call that maps to an `app.action` that would normally need approval from the dashboard is rendered as a suggestion card in the chat, with Approve/Reject inline. On approve, the action goes through the standard pipeline and status updates render live in the same card.

## History

- Conversations are persisted per household.
- Any member can open any conversation.
- Edit-history is preserved when a member edits a prior message (rare; not the primary pattern).

## Memory trace

A "why?" button on every agent message opens an evidence drawer listing:

- Facts the agent relied on, with their `valid_from`/`valid_to`.
- Episodes retrieved.
- Patterns / rules that shaped the response.
- Tool call sequence.

This is the same evidence drawer used on suggestion cards in the dashboard; it's the surface [`../04-memory-network/user-controls.md`](../04-memory-network/user-controls.md) calls out as trust-critical.

## Composer

- Plain text with markdown fallback rendering (for emphasis/code).
- `@` opens entity picker (person, dish, merchant) to anchor a message to a specific node.
- `/` opens a slash-command menu: `/forget this`, `/remember X`, `/summarize <topic>`, `/plan meals week`.
- Attachments: receipt photos go through `mcp-ingest`. A drop-in receipt becomes an enriched transaction and the agent can reference it in the same turn.

## Accessibility

- Screen-reader announcements for tool-call start/finish and action approvals.
- Keyboard: full navigation without mouse.
- Streaming text does not announce every token; it announces on logical pauses.

## Dependencies

- [`agent-loop.md`](./agent-loop.md)
- [`tools.md`](./tools.md)
- [`../07-frontend/ui-architecture.md`](../07-frontend/ui-architecture.md)
- [`../04-memory-network/user-controls.md`](../04-memory-network/user-controls.md)

## Open questions

- Do we render the context panel by default or opt-in? Opt-in; too distracting as default.
- Should members see each other's in-flight drafts? No — drafts are local until send.
