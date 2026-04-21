# Enrichment Pipeline

**Purpose.** How a newly-inserted row becomes episodes, candidate facts, nodes, edges, and updated documents in the memory graph.

**Scope.** The orchestration — worker, queues, triggers, idempotency. The *semantics* of what's extracted (atomic-fact shape, reconciliation, conflict handling, consolidation) live in their own docs:

- [`extraction.md`](./extraction.md) — atomic-fact shape and candidate/canonical flow.
- [`consolidation.md`](./consolidation.md) — nightly roll-up and reflection.
- [`conflict-resolution.md`](./conflict-resolution.md) — how contradictions resolve.
- [`temporal.md`](./temporal.md) — bi-temporal writes.

This document describes the pipeline plumbing that all of those ride on.

## Trigger

Every `app.*` table that represents ingestible content (events, transactions, emails, meals, etc.) has an `AFTER INSERT` trigger that enqueues an `enrich` job on `pgmq`:

```sql
create trigger enrich_event_after_insert
after insert on app.event
for each row execute function jobs.enqueue_enrich('event');
```

The job payload is `{ entity_type, entity_id, household_id, enrichment_version }`.

## Worker

`enrichment-worker` on Railway. Horizontally scaled. Each process:

1. Claims a job from `pgmq.enrich_*`.
2. Loads the full row plus a small context window (related rows in the same household, e.g., last 20 events for the attendee list).
3. Runs the enrichment prompt against Kimi via OpenRouter.
4. Parses the structured JSON response.
5. Writes nodes, edges, and node-document updates transactionally.
6. ACKs the job.

## Prompt structure

One prompt template per entity type. Each returns structured JSON with:

- `entities[]` — extracted entities: `{ type, canonical_name, aliases[], attributes }`.
- `edges[]` — proposed edges: `{ src_type, src_name, dst_type, dst_name, edge_type, weight, evidence }`.
- `classifications` — entity-specific tags (e.g., a calendar event's segment, a transaction's category override).
- `summary` — a one-sentence natural-language summary used in downstream retrieval.

Prompts are version-controlled in `packages/prompts/enrichment/*.md`. Prompt changes bump `enrichment_version`, which re-triggers reprocessing via the backfill job.

## Entity resolution

Extracted entities are resolved against existing nodes before creating new ones:

1. Exact match on `canonical_name` within `(household_id, type)`.
2. Alias match on `mem.alias`.
3. Fuzzy match (`pg_trgm` similarity > threshold) against canonical names.
4. Embedding match against existing node embeddings if still ambiguous.
5. Otherwise, create a new node.

Ambiguous matches (multiple strong candidates) are written with a `needs_review` flag and surfaced in the graph browser for member resolution.

## Node document regeneration

When a node's linked content changes materially (new edges, attribute updates), a debounced job regenerates the node's `document_md`:

- Pulls the latest N edges by recency and weight.
- Runs a "node-card" prompt that produces the canonical document.
- Preserves any manual notes section verbatim (edits by members).

Regeneration is throttled per node (max once per hour in normal operation) to avoid LLM churn.

## Idempotency

- Job keyed on `(entity_type, entity_id, enrichment_version)`. Re-enqueuing is a no-op if already processed.
- Node writes are upserts on `(household_id, type, canonical_name)`.
- Edge writes are upserts on `(household_id, src_id, dst_id, edge_type)` — weights update, duplicates don't accumulate.

## Reprocessing

When prompts change, a `backfill` job re-enqueues all entities of the affected type at the new version. Old version's nodes/edges are diffed and updated, not dropped.

## Errors

- Model parse failure → job moves to `sync.dead_letter` after 3 retries with backoff.
- Provider rate limit → backoff with jitter; preserve household-level ordering.
- Graph-write conflict (concurrent update) → retry within the job.
- Dead-lettered jobs are visible in an internal dashboard; the member sees a generic "enrichment pending" state in the graph browser for affected entities.

## Cost

- Enrichment is the dominant model spend. Batching: for email-heavy syncs, batch up to N similar messages per prompt to amortize tokens.
- Per-household rate budget prevents runaway costs; configurable in settings.

## Dependencies

- [`graph-schema.md`](./graph-schema.md)
- [`../05-agents/model-routing.md`](../05-agents/model-routing.md)
- [`../08-backend/queues.md`](../08-backend/queues.md)

## Open questions

- Batching policy: always batch-by-type, or only batch similar items? Start with "always batch within a 10-second window."
- How to preserve member manual-notes across schema migrations: store them in a separate column (`mem.node.manual_notes_md`) rather than inline. Leaning yes.
