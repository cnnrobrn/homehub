# @homehub/worker-enrichment

Consumes `enrich_event` pgmq messages produced by sync-\* workers and
writes a classification back to `app.event`.

- **Owner:** @memory-background
- **Status:** M2-B — deterministic regex/keyword classifier (no model
  calls yet). The model-backed path (Kimi K2 + `mem.fact_candidate` +
  reconciler) lands in M3.

## What it does today

For each claimed `enrich_event` message:

1. Loads the `app.event` row by `(household_id, entity_id)`.
2. Runs `createDeterministicEventClassifier()` from
   `@homehub/enrichment` to pick a `segment` + `kind` + confidence +
   ordered `signals`.
3. Updates `app.event`: `segment = <classification>`,
   `metadata.enrichment = <classification + version tag>`,
   `updated_at = now()`.
4. Writes an `audit.event` row with `action='event.enriched'` and
   before/after snapshots.

Failures (row not found, DB update error, classifier throw) route to
`sync.dead_letter` with the full envelope for replay.

## What lands in M3

- Kimi K2 extraction call via `@homehub/worker-runtime`'s `generate()`
  helper, producing `episodes` + atomic `facts` per
  `specs/04-memory-network/extraction.md`.
- `mem.fact_candidate` writes; the reconciler then promotes or
  conflicts them per `specs/04-memory-network/conflict-resolution.md`.
- A `model_calls` ledger row per call and per-household
  `model_budget_monthly_cents` enforcement.

See `specs/05-agents/workers.md` and the briefing in
`scripts/agents/memory-background.md` for the catalog + owner context.
