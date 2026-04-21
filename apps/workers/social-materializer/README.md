# @homehub/worker-social-materializer

Materializes birthday + anniversary facts into `app.event` rows on a rolling
12-month horizon.

- **Owner:** @memory-background
- **Spec:** `specs/06-segments/social/calendar.md`

## What this service ships (M8)

Two entries:

- `src/main.ts` — long-running HTTP server (`/health`, `/ready`). No poll
  loop; materialization is cron-driven. The process stays alive so Railway
  has stable logs and a readiness target.
- `src/cron.ts` — one-shot pass. Materializes birthday + anniversary
  occurrences for every household, then exits.

## Algorithm

For each household:

1. Load `mem.fact` rows with predicate in `{has_birthday, has_anniversary}`
   that are currently valid (`valid_to IS NULL` AND `superseded_at IS NULL`).
2. Parse the month/day from `fact.object_value` (accepts `YYYY-MM-DD`,
   `MM-DD`, and `{ month, day }` JSON shapes). Leap-day birthdays fall back
   to Feb 28 in non-leap years.
3. Compute the next occurrence on or after `now`.
4. Upsert an `app.event` row with `segment='social'`, `kind='birthday'` or
   `'anniversary'`, `all_day=true`, and metadata
   `{ subject_node_id, predicate, source_fact_id, materialized_by }`.
   Idempotence relies on the partial unique index
   `(household_id, kind, starts_at, metadata->>subject_node_id)` requested
   in migration `0014_social.sql`.
5. Sweep previously materialized future events that no longer have a
   matching active fact and flag them `metadata.stale=true`. Past events
   are left intact (they are historical record).

No model calls. No cross-household cost: a household with zero
birthday/anniversary facts costs one fact query and exits.

## Railway cron schedule

```
15 5 * * *    # daily 05:15 UTC → pnpm cron
```

Operator one-shots:

```
pnpm cron                                      # all households
pnpm cron --household=<uuid>                   # restrict to one household
pnpm cron --household=<uuid> --household=...   # restrict to many
```

## Env

Standard worker runtime (`workerRuntimeEnvSchema`): Supabase service key,
URL, logging, OTel. No Nango, no model keys — deterministic.
