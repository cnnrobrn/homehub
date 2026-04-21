# Agent Tools

**Purpose.** The tool catalog the foreground agent can call during a turn.

**Scope.** Every tool, its class (read / draft-write / direct-write), arguments, and the approval rules that attach to draft-writes.

## Classes

- **read** — returns data, no side effects.
- **draft-write** — creates a `suggestion` or a draft; does *not* execute. UI renders inline for member approval.
- **direct-write** — writes immediately. Used only for low-risk memory/state updates.

## Memory tools

### `query_memory` — read
Layer-aware retrieval. See [`../04-memory-network/retrieval.md`](../04-memory-network/retrieval.md).

### `get_node` — read
Fetch a specific node by id or by canonical name.

### `get_episode_timeline` — read
Episodes for a subject within a time range.

### `remember_fact` — direct-write
Add a member-authored fact. High confidence; goes straight to canonical (skipping the candidate pool). Args: `subject_node`, `predicate`, `object`, optional `valid_from`.

### `supersede_fact` — draft-write
Propose an edit to an existing canonical fact. Shown as a memory diff card for confirmation; confirms then applies supersession. Never auto-executes for `destructive_if_wrong` predicates (see [`../04-memory-network/conflict-resolution.md`](../04-memory-network/conflict-resolution.md)).

### `forget_fact` — draft-write
Proposes deletion of a canonical fact with confirmation card. Audit-logged.

### `create_rule` — direct-write
Member-authored procedural rule. Args: `description`, optional `predicate_dsl`. Direct because rules are editable and non-destructive.

## Household state tools

### `list_events` — read
Unified calendar read. Args: `start`, `end`, optional `segment`, `member`.

### `list_transactions` — read
Args: range, filters. Respects per-segment grants.

### `list_meals` — read
Args: date range, slot.

### `get_pantry` — read
Current pantry inventory.

### `get_grocery_list` — read
Current draft or latest placed list.

### `get_account_balances` — read
Member's visible accounts per grants.

### `get_budget_status` — read
Budgets with progress vs. period.

### `list_suggestions` — read
Active suggestions by segment.

### `get_household_members` — read
Roster with relationships.

## Write-through-approval tools (draft-write)

These create suggestions or drafts; actual execution is the standard approval flow in [`../05-agents/approval-flow.md`](../05-agents/approval-flow.md).

### `draft_meal_plan`
Args: `start_date`, `end_date`, `constraints` (dietary, effort, variety). Writes a meal-plan preview; inline editor on the card.

### `propose_grocery_order`
Args: `planned_for`, `provider`, optional overrides. Writes a draft `grocery_list`.

### `propose_transfer`
Args: `from_account`, `to_account`, `amount_cents`, `reason`. Creates a suggestion card.

### `propose_cancel_subscription`
Args: `subscription_node`. Surfaces the provider-specific path (may be draft Gmail or provider API).

### `draft_message`
Args: `recipient_person`, `body`. Creates a Gmail draft in the member's account.

### `propose_add_to_calendar`
Args: `title`, `start`, `end`, `attendees`, optional `mirror_to_gcal`. Creates a calendar-event suggestion.

### `propose_book_reservation`
Args: venue, party, time window. Draft via Gmail if no provider API.

### `settle_shared_expense`
Args: `counterparty_member`, `amount`. Creates a settle-up suggestion + optional draft message.

## Direct-write convenience tools

Low-risk state changes the member can safely let the agent perform without a confirmation card:

### `add_meal_to_plan`
Args: `date`, `slot`, `dish`. Writes `app.meal`. Undo via the meal row.

### `update_meal`
Update or remove a planned meal.

### `add_pantry_item` / `update_pantry_item` / `remove_pantry_item`
Direct write to pantry.

### `mark_alert_dismissed`
Dismiss by id.

### `snooze_suggestion`
Push a suggestion's expiry out.

## Scoping

- Every tool invocation is checked against the member's segment grants (Food tools need Food grant, etc.).
- Tools that touch another member's data (account, inbox) are blocked unless the caller has the appropriate account-level grant.

## Schemas

All tool argument schemas live in `packages/tools/schemas/*.ts` as Zod. Tool descriptions shown to the model are generated from the same source of truth so model-visible docs and runtime validation never drift.

## Adding a new tool

Checklist:

1. Add schema + handler in `packages/tools`.
2. Classify: read / draft-write / direct-write. Default to draft-write when unsure.
3. Wire into `apps/workers/foreground-agent` tool registry.
4. If direct-write, justify why approval isn't needed (must be trivially undoable and scoped to household's own data).
5. Add unit tests for the handler and an eval case in the foreground-agent eval suite.
6. Update this doc.

## Dependencies

- [`agent-loop.md`](./agent-loop.md)
- [`../05-agents/approval-flow.md`](../05-agents/approval-flow.md)
- [`../04-memory-network/retrieval.md`](../04-memory-network/retrieval.md)
- [`../03-integrations/mcp.md`](../03-integrations/mcp.md) — most of these tools are also exposed over MCP.

## Open questions

- Parallel reads: `query_memory` + `list_events` in parallel is safe and fast. Enable for reads only when we ship.
- A generic `run_sql` escape hatch for advanced members? No — flattens the abstraction and invites injection issues. All access is through named tools.
