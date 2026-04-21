# @homehub/worker-backup-export

Exports a household's data as a deterministic ndjson bundle and uploads
it to Supabase Storage (bucket `household_exports`). Owner-triggered via
`requestHouseholdExportAction` in the web app.

## Bundle shape

```
<householdId>/<timestamp>/
  household.json            # household + members + grants
  events.ndjson             # app.event rows
  transactions.ndjson       # app.transaction rows (when present)
  meals.ndjson              # app.meal rows (when present)
  pantry.ndjson             # app.pantry_item rows (when present)
  memory/nodes.ndjson
  memory/facts.ndjson
  memory/episodes.ndjson
  memory/edges.ndjson
  manifest.json             # export metadata + row counts
```

Two runs over identical data produce byte-identical output — see
`src/serialize.test.ts`. That makes it possible for an operator to diff
manifests across time.

## Triggering

- Web UI: `/ops/dlq` / settings (owner only) → export button. The UI
  calls `requestHouseholdExportAction`, which inserts a row into
  `sync.household_export` and enqueues a `household_export` pgmq
  message.
- CLI: (future) `pnpm --filter @homehub/worker-backup-export start`
  with `HOMEHUB_HOUSEHOLD_ID=<uuid>` for manual exports.

## Env

Inherits the shared worker runtime env (SUPABASE\_\*, OTel knobs,
Sentry, etc.).

## Import

Import is intentionally out of scope for M10. See
`docs/ops/backup-restore.md` for the manual restore procedure.
