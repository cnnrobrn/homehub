# Background Workers

**Purpose.** The long-running processes on Railway. One service per worker class.

**Scope.** Responsibilities, invocation, concurrency, and idempotency.

## Worker classes

| Worker                   | Trigger                          | What it does                                     |
|--------------------------|----------------------------------|--------------------------------------------------|
| `sync-gcal`              | Webhook + hourly poll            | Pulls calendar events, writes to `app.event`     |
| `sync-gmail`             | Pub/Sub + hourly poll            | Ingests labeled Gmail messages                   |
| `sync-financial`         | Hourly poll                      | Pulls transactions/accounts from Monarch/YNAB/Plaid |
| `sync-grocery`           | Webhook + poll                   | Pulls grocery order status                       |
| `webhook-ingest`         | HTTP                             | Single public ingress for all provider webhooks  |
| `enrichment`             | `pgmq` `enrich_*`                | Writes to memory graph                           |
| `node-regen`             | `pgmq` `node_regen`              | Regenerates node documents                       |
| `reconciler`             | Cron, hourly                     | Dedups email-vs-budget-app transactions          |
| `pantry-diff`            | Cron, on meal/list change        | Recomputes grocery lists from meal plan          |
| `summaries`              | Cron (daily/weekly/monthly)      | Writes `app.summary`                             |
| `alerts`                 | Event + cron                     | Writes `app.alert`                               |
| `suggestions`            | Event + cron                     | Writes `app.suggestion`                          |
| `action-executor`        | `pgmq` `execute_action`          | Executes approved actions via Nango/MCP          |
| `backfill`               | Ad-hoc                           | Reprocesses entities on prompt/schema changes    |

## Shared runtime

- All workers share a base package (`packages/worker-runtime`) providing:
  - Supabase service client.
  - `pgmq` wrapper with claim/retry/DLQ semantics.
  - Nango client.
  - OpenRouter client via the `generate()` helper.
  - Structured logging + tracing.
  - Graceful shutdown on SIGTERM.
- Each worker service is a thin `main.ts` that composes the runtime with its handler.

## Concurrency model

- `pgmq` with visibility timeouts.
- Per-household FIFO: a queue partition per household (via `visibility_timeout` + `ordering_key = household_id`) so no household's data is processed out of order.
- Across households: parallel. Worker service scales horizontally on Railway.

## Idempotency rules

1. Every worker handler is idempotent. Re-running the same job produces the same result.
2. Writes use upserts on stable keys. No `INSERT` without a conflict target.
3. Side effects to third parties (placing an order, sending an email) are guarded by an `action` row whose status transitions are the source of truth. The external call is made only when status moves `pending → running`; retries from `running` check external state first before re-issuing.

## Health & lifecycle

- Each worker exposes `/health` (liveness) and `/ready` (can claim jobs).
- Railway restarts on liveness failure; readiness failure drains the worker.
- Deploys are zero-downtime: new instance becomes ready before old is drained.

## Failure & dead letter

- Transient failures: exponential backoff, up to N attempts.
- Terminal failures: job moves to `sync.dead_letter` with full context for debugging.
- DLQ triage: internal dashboard lists DLQ entries per household per worker; an owner can trigger re-process after fix.

## Dependencies

- [`../08-backend/queues.md`](../08-backend/queues.md)
- [`../03-integrations/nango.md`](../03-integrations/nango.md)
- [`model-routing.md`](./model-routing.md)

## Open questions

- Is `pgmq`'s per-message ordering sufficient for per-household FIFO, or do we need an explicit ordering_key column? Leaning: `pgmq` partitions per queue; we create one queue per worker class and use ordering_key.
- Worker scale signals: queue depth is the primary; add p95 processing time as a secondary.
