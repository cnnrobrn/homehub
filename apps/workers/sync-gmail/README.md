# @homehub/worker-sync-gmail

Ingests labeled Gmail messages via Pub/Sub + periodic poll and writes
`app.email` + `app.email_attachment` + Supabase Storage attachments.
Labels ingested messages as `HomeHub/Ingested` in Gmail.

- **Owner:** @integrations
- **Milestone:** M4-A

## Queues consumed

- `sync_full:gmail` — initial backfill: last 180 days of messages
  matching the member's opt-in category filters.
- `sync_delta:gmail` — incremental sync driven by the stored
  historyId.

## Enqueues

- `enrich_email` — one envelope per upserted `app.email` row, consumed
  by @memory-background's extraction worker in M4-B.

## Cursors

- `sync.cursor` `kind='gmail.history_id'` — the highest Gmail historyId
  we've observed.
- `sync.cursor` `kind='gmail.watch'` — JSON `{ history_id, expiration,
email_address }` seeded by the Nango webhook when `users.watch`
  succeeds.

## Feature flag: `HOMEHUB_EMAIL_INGESTION_ENABLED`

Defaults to `false` until migration `0012_email_ingestion.sql` lands
(tables `app.email`, `app.email_attachment`, Storage bucket
`email_attachments`). When `false`:

- The worker still claims `sync_*:gmail` jobs.
- It hits Nango + Gmail normally (to shake out scopes + watch flow).
- It logs `email ingestion disabled; skipping persist` for each batch.
- It does **not** write to `app.email`, `app.email_attachment`,
  Storage, or apply the `HomeHub/Ingested` label.
- Cursor + audit rows are still written so operators can see activity.

Flip to `true` once:

1. Migration 0012 has applied in the target environment.
2. `pnpm --filter @homehub/db db:types` has regenerated types and been
   committed.
3. The Supabase Storage `email_attachments` bucket exists with the
   policies from the migration.

## Error routing

- `HistoryIdExpiredError` (Gmail 404 on `history.list`) — clear the
  stored historyId cursor and requeue as `sync_full:gmail`.
- `RateLimitError` (429 / 403 `rateLimitExceeded`) — nack with the
  provider's `Retry-After`.
- Anything else — `sync.dead_letter` + ack.

## Privacy

- Only `format=METADATA` fetched per message. Body preview capped at
  2KB per `specs/09-security/data-retention.md`.
- Attachments persisted at
  `email_attachments/<household_id>/email/<email_id>/<attachment_id>`
  with RLS scoped to household membership.
- Labels, never deletes. No send scope.

See `infra/nango/providers/google-mail.md` for the Pub/Sub + OAuth
setup and `specs/03-integrations/google-workspace.md` for scope /
category / sync-model spec.
