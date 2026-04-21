# Pages

**Purpose.** The screens a member can reach and what each one is for.

**Scope.** Page inventory with purpose, key elements, and data sources.

## Global

### `/` — Dashboard (combined)
The home screen. A household member opens the app and lands here.

- **Today strip**: calendar events across all four segments for today.
- **Alert bar**: critical + warn-level active alerts.
- **Suggestions carousel**: top-N pending suggestions, diversified across segments.
- **Segment cards**: four tiles (Financial, Food, Fun, Social), each showing a 1-line status and link.
- **Quick capture**: receipt upload, add-to-pantry, add-meal, add-person.
- **Ask launcher**: `⌘K` opens a chat panel anchored to the header for quick questions without leaving context.

### `/chat` — Conversation
First-party chat with HomeHub. Ask questions, plan, draft, or teach memory.

- Conversation history sidebar.
- Streaming tokens with inline tool cards.
- Inline approval for draft-write tool results (suggestion cards).
- Context panel (collapsible) showing retrieved facts/episodes.
- Memory trace ("why?") drawer on every assistant message.

Launcher-style access from anywhere via `⌘K`. See [`../13-conversation/`](../13-conversation/).

### `/memory` — Graph browser
Obsidian-style explorer over the memory graph.

- Search box (semantic + exact).
- Left rail: node types.
- Center: node document (`document_md`) rendered from `mem.node`.
- Right rail: linked nodes grouped by edge type.
- "Evidence" drawer: raw rows that fed this node.

## Per-segment

Each segment has a similar shape:

### `/{segment}`
- Segment dashboard: next 7 days calendar strip, latest summary, active alerts, pending suggestions.

### `/{segment}/calendar`
- Full calendar for the segment (week / month / timeline).

### `/{segment}/summaries`
- List of prior summaries with deep-links to originating events/rows.

### `/{segment}/alerts`
- Active + dismissed alerts, filterable.

### `/{segment}/suggestions`
- Pending suggestions with `preview` cards and Approve/Reject.

## Segment-specific

### Financial
- `/financial/transactions` — ledger with filters.
- `/financial/accounts` — balances, health per account.
- `/financial/budgets` — category progress.
- `/financial/subscriptions` — detected recurring charges.

### Food
- `/food/meal-planner` — week grid, drag-drop.
- `/food/pantry` — inventory.
- `/food/groceries` — current drafts and past orders.
- `/food/dishes` — dish library (backed by memory nodes).

### Fun
- `/fun/trips` — multi-day plans.
- `/fun/queue` — books / shows / games to do (simple list in v1).

### Social
- `/social/people` — directory.
- `/social/people/{personId}` — person detail (pulled from memory node).

## Settings

- `/settings/household` — name, timezone, currency, week start, approval policies.
- `/settings/connections` — per-member Nango connections + MCP tokens.
- `/settings/members` — invites, roles, per-segment grants.
- `/settings/notifications` — alert categories, quiet hours, email/push preferences.
- `/settings/model-usage` — LLM spend with breakdowns.

## Auth

- `/login` — email magic link + Google.
- `/invite/{token}` — invite acceptance.

## Dependencies

- [`ui-architecture.md`](./ui-architecture.md)
- [`components.md`](./components.md)
