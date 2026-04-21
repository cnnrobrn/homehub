# @homehub/worker-sync-financial

Pulls transactions, accounts, and budgets from financial providers.
Ships with a YNAB adapter in M5-A; Monarch + Plaid follow in M5-B+.

- **Owner:** `@integrations`
- **Milestone:** M5-A
- **Consumes:** `sync_full:{provider}` and `sync_delta:{provider}` queues
  (pgmq), one pair per provider (today: `ynab`).
- **Produces:** Writes to `app.transaction`, `app.account`, `app.budget`,
  `sync.cursor`, and `audit.event`.

## Scripts

- `pnpm dev` — hot-reload the main poll loop against the local stack.
- `pnpm start` — production entrypoint (compiled).
- `pnpm cron` — one-shot fan-out that enqueues `sync_delta:{provider}`
  for every active financial connection. Invoke hourly via Railway's
  cron trigger.

## Feature flag

`HOMEHUB_FINANCIAL_INGESTION_ENABLED` — default `true`. Set to `false`
or `0` to exercise the Nango + queue wiring against a live YNAB account
without writing to `app.transaction` / `app.account` / `app.budget`.

## Cron configuration (Railway)

Configure a Railway cron trigger on the same service:

- **Command:** `node dist/cron.js`
- **Schedule:** `0 * * * *` (hourly at :00).

The main long-lived process is the pgmq consumer; the cron is a
separate short-lived invocation that exits after fan-out.

## Error policy

- `CursorExpiredError` (YNAB 409 `knowledge_out_of_date`) — drop the
  stored cursor and requeue as `sync_full:{provider}`. Ack the current
  message.
- `RateLimitError` (429) — nack with the carried retry-after delay.
- Anything else — dead-letter via `sync.dead_letter` and ack.

## Data layout

- `sync.cursor` rows carry `kind='ynab.knowledge'` with the YNAB
  `server_knowledge` value as `value`.
- `app.transaction.source = 'ynab'` for YNAB-sourced rows; idempotent
  upsert key `(source, source_id)`.
- `app.account` upsert key `(provider, external_id)`.

See `specs/03-integrations/budgeting.md` for the normalization contract
and `infra/nango/providers/ynab.md` for the provider setup runbook.
