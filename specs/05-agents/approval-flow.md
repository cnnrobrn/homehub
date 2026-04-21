# Approval Flow

**Purpose.** How a suggestion becomes an executed action, and what safeguards live between those two states.

**Scope.** State machine, required approvers, audit.

## State machine

```
suggestion.pending
   │
   ├── member taps Approve ──▶ action.pending ──▶ action.running ──▶ action.succeeded | action.failed
   │                                                                                │
   │                                                                                └─▶ suggestion.executed (or .failed)
   │
   ├── member taps Reject ─▶ suggestion.rejected
   │
   └── 14 days pass ──────▶ suggestion.expired
```

## Required approvers

Some actions need more than one member's tap:

| Action kind              | Required approvers                               |
|--------------------------|--------------------------------------------------|
| `transfer_funds`         | The account owner. Second member only if > $X (household-configurable). |
| `place_grocery_order`    | One adult with write access to Food.             |
| `cancel_subscription`    | Account owner.                                    |
| `add_to_calendar`        | The member whose calendar it is.                  |
| `send_message`           | Not auto-sent in v1. Member always drafts before send. |

Thresholds and policies live in `app.household.settings.approvals`.

## Auto-approval

Per category, a household owner can enable auto-approval under a dollar threshold. Example: "auto-approve meal swaps without consent, require approval for anything that costs money." Auto-approval is off by default and audit-logged whenever it fires.

## What happens on Approve

1. Server action validates the member has rights for this suggestion's segment and the suggestion's preview hasn't been tampered with (hash check).
2. `action` row created from the suggestion's `preview`.
3. `suggestion.status = approved`.
4. `execute_action` job enqueued.
5. UI shows "executing…" state via realtime.

## Action executor

The `action-executor` worker:

1. Claims the action.
2. Transitions to `running`.
3. Calls the provider via Nango proxy or the relevant MCP tool.
4. On success, writes `result` and transitions to `succeeded`; marks suggestion `executed`.
5. On failure, writes `error` and transitions to `failed`; marks suggestion `failed`.
6. On unexpected termination, a reconciliation pass verifies external state before retrying.

## Audit

Every approval is logged:

```
audit.event(
  actor_user_id, action='suggestion.approve',
  resource_type='suggestion', resource_id, before, after, at
)
```

Every action execution is logged with inputs + outputs (redacted where sensitive).

## Reversal

Some actions can be reversed by a follow-up action (e.g., a fund transfer has a corresponding "reverse transfer" action). The UI surfaces a "Undo" affordance for reversible kinds. Non-reversible kinds (placing an order) simply cannot be undone and the UI labels them as such before approval.

## Dependencies

- [`suggestions.md`](./suggestions.md)
- [`workers.md`](./workers.md)
- [`../02-data-model/schema.md`](../02-data-model/schema.md) — `app.action`, `audit.event`.

## Open questions

- Multi-approver UX: when two approvers needed, do we notify the second automatically or wait for the first member to explicitly request? Leaning notify-with-context.
- Time-bounded approvals (e.g., must execute within 2 hours of approval) to avoid stale preview data. Yes for financial; decide per-category.
