# Backup + restore

## Backups we run

### 1. Supabase automated backups

Supabase takes nightly backups on the Pro plan with 7-day retention and
point-in-time recovery within that window. We rely on this for the
primary application database. No app-level config — confirm the
retention in the project dashboard.

### 2. Nango logical dump

Weekly logical dump into a separate Supabase Storage bucket. Procedure
and ownership live in
[`infra/nango/docs/production-deploy.md`](../../infra/nango/docs/production-deploy.md#backups).

### 3. Household-data export (per-household, on demand)

Owners can request a portable export of a single household from the
settings UI. The flow:

1. Owner triggers `requestHouseholdExportAction` (web).
2. Web inserts a row in `sync.household_export` (status `pending`) and
   enqueues a pgmq message on `household_export`.
3. `@homehub/worker-backup-export` claims the message, runs
   `runHouseholdExport()`, and uploads the bundle to
   `household_exports/<household_id>/<timestamp>/`.
4. The worker updates the `sync.household_export` row to `succeeded`
   (with `size_bytes`, `storage_path`) or `failed` (with `error`).

Bundle shape (see `apps/workers/backup-export/README.md`):

```
household.json
events.ndjson
transactions.ndjson
meals.ndjson
pantry.ndjson
memory/nodes.ndjson
memory/facts.ndjson
memory/episodes.ndjson
memory/edges.ndjson
manifest.json
```

Serialization is deterministic — two runs over identical data produce
byte-identical output. Operators can use the manifest's row counts
plus a sha256 of the bundle for integrity verification.

## Restore — manual

**Household-data restore is intentionally manual in M10.** Import is
future work (see [dispatch notes](../../scripts/agents/infra-platform.md))
because bringing rows back into a live database needs careful
conflict-handling rules that are outside the M10 scope.

### When to restore

- A household member reports deleted / corrupted data.
- The household was accidentally cascaded (not possible today — FKs
  are `on delete cascade` only from `household` downward — but we
  guard the procedure for future shape changes).

### Procedure (operator-only)

1. Identify the most recent export in
   `sync.household_export` for the household. If none, escalate to
   Supabase point-in-time recovery on the primary DB.
2. Download the bundle: Supabase Storage →
   `household_exports/<household_id>/<timestamp>/*`.
3. Import into a throwaway Postgres instance (local Docker) to
   inspect. **Never** pg_restore directly into prod.
4. Reconcile the affected tables row-by-row against the live DB.
   Usually a small surgical `insert ... on conflict` is enough.
5. Announce to the affected owner. Document in the incident timeline.

### Supabase point-in-time recovery

For broader data loss (accidental mass delete, migration typo), use
Supabase's PITR:

1. Supabase dashboard → Database → Backups → Choose a restore point.
2. Supabase provisions a fork at the target timestamp (new project).
3. Export the affected rows from the fork, apply to live via a
   one-off SQL migration.
4. Delete the fork to avoid ongoing cost.

Never run `supabase db reset`. Ever. See
[`packages/db/README.md`](../../packages/db/README.md) for the full
non-negotiables list.
