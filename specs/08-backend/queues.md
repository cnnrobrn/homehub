# Queues

**Purpose.** How asynchronous work is coordinated between triggers and workers.

**Scope.** `pgmq` queues, naming, semantics.

## Primary: `pgmq`

We use the `pgmq` extension in Supabase Postgres for all durable job queues. Reasons:

- Transactional with the data changes that trigger jobs — no dual-write.
- Single backup surface (the Postgres backup covers queues too).
- No additional moving part to operate.

If throughput later requires it, we can add a Redis/BullMQ layer in front for specific high-rate queues without changing semantics.

## Queue inventory

| Queue name              | Producer                                   | Consumer         |
|-------------------------|---------------------------------------------|------------------|
| `sync_full:{provider}`  | `sync.provider_connection` creation/reauth | `sync-*`         |
| `sync_delta:{provider}` | Cron + webhook                             | `sync-*`         |
| `enrich_event`          | `app.event` trigger                        | `enrichment`     |
| `enrich_email`          | `app.email` trigger                        | `enrichment`     |
| `enrich_transaction`    | `app.transaction` trigger                  | `enrichment`     |
| `enrich_meal`           | `app.meal` trigger                         | `enrichment`     |
| `node_regen`            | Enrichment (on material change)            | `node-regen`     |
| `reconcile_transaction` | Cron + manual                              | `reconciler`     |
| `pantry_diff`           | `app.meal` / `app.pantry_item` triggers    | `pantry-diff`    |
| `generate_summary`      | Cron                                       | `summaries`      |
| `evaluate_alerts`       | Triggers + cron                            | `alerts`         |
| `generate_suggestions`  | Cron + triggers                            | `suggestions`    |
| `execute_action`        | `app.action` insert                        | `action-executor`|
| `backfill:{target}`     | Ad-hoc                                     | `backfill`       |

## Message schema

Every message is:

```json
{
  "household_id": "uuid",
  "kind": "enrich_event",
  "entity_id": "uuid",
  "version": 3,
  "enqueued_at": "ISO8601"
}
```

Workers validate schema on claim; malformed messages → DLQ.

## Visibility & retry

- Default visibility timeout: 60 seconds; workers bump as needed for long tasks.
- Retry budget: 3 (configurable per queue).
- DLQ: `sync.dead_letter` rows preserve payload + error.

## Ordering

- Per-household ordering is enforced by claiming with `ordering_key = household_id`.
- Cross-household: parallel, no ordering.

## Backpressure

- When a queue's depth exceeds a threshold, upstream producers (triggers) throttle via a `jobs.should_enqueue(queue)` check.
- Model-bearing queues also check the per-household budget before claiming.

## Observability

- Depth + age-of-oldest per queue in the internal dashboard.
- DLQ count per queue per day; alert if non-zero.

## Dependencies

- [`workers.md`](./workers.md)
- [`../05-agents/workers.md`](../05-agents/workers.md)
- [`../10-operations/observability.md`](../10-operations/observability.md)
