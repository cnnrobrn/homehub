# Realtime

**Purpose.** How the UI stays current without polling.

**Scope.** What channels exist, what they deliver, and how components subscribe.

## Channels

Supabase Realtime publishes row-level events filtered by `household_id`. Subscriptions:

| Channel              | Rows                                | Consumers                                 |
|----------------------|--------------------------------------|-------------------------------------------|
| `alerts:{household}` | `app.alert`                          | AlertBar, per-segment panels              |
| `suggestions:{household}` | `app.suggestion`                | Dashboard suggestion carousel, per-segment |
| `events:{household}` | `app.event`                          | Calendar views, Today strip               |
| `summaries:{household}` | `app.summary`                     | Summary pages                              |
| `meals:{household}`  | `app.meal`                           | Meal planner                              |
| `actions:{household}`| `app.action`                         | Approval UI, "executing…" states          |

## Subscription model

- Client components subscribe on mount via a `useHouseholdRealtime(table)` hook.
- Hook reuses a single shared WebSocket connection; filters applied per-component.
- Subscriptions unmount with the component. No leaks.

## Reconnection

- On transient disconnect, the hook reconnects and performs a reconciliation read against the server to close any gap.
- The dashboard shows a subtle "reconnecting…" indicator; it clears on recovery.

## Optimistic UI

- Mutations via server actions return the updated row; client reconciles with any in-flight realtime event.
- Approving a suggestion optimistically flips its card to `approved` pending confirmation.

## Realtime vs. pull

- Any read that can be server-rendered is server-rendered. Realtime only re-renders the delta on top.
- No realtime for memory-graph mutations in v1 — nodes/edges change slowly enough that a refresh button is fine.

## Dependencies

- [`ui-architecture.md`](./ui-architecture.md)
- [`../02-data-model/row-level-security.md`](../02-data-model/row-level-security.md) — RLS applies to realtime too.

## Open questions

- Presence (showing "Alex is also looking at the meal planner"): nice-to-have; post-v1.
- Per-member vs. per-household channels: per-household is simpler and sufficient while RLS enforces visibility.
