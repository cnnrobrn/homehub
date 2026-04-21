# @homehub/worker-reconciler

Reconciles email-derived transactions (`source='email_receipt'`) with
provider-side transactions (`source in ('ynab','monarch','plaid')`).

- **Owner:** `@integrations`
- **Milestone:** M5-A
- **Consumes:** nothing (no pgmq queues — cron-driven).
- **Produces:** Updates `app.transaction.metadata` on both sides of a
  matched pair; writes `audit.event` per household per run.

## Scripts

- `pnpm dev` — run the long-lived process that serves `/health` +
  `/ready` and idles. The cron entry is a separate invocation.
- `pnpm start` — production entrypoint (compiled).
- `pnpm cron` — one-shot reconciliation pass. Invoke hourly via
  Railway's cron trigger.

## Cron configuration (Railway)

Configure a Railway cron trigger on this service:

- **Command:** `node dist/cron.js`
- **Schedule:** `15 * * * *` (hourly at :15 — offset from the
  sync-financial cron at :00 so the provider-side inventory is fresh
  when the reconciler runs).

## Algorithm

Per household (hourly):

1. Query `app.transaction` where
   `source='email_receipt' AND occurred_at >= now() - 30 days` and
   `metadata->>'matched_transaction_id' IS NULL`.
2. For each candidate, search `source in ('ynab','monarch','plaid')`
   in the same household within:
   - ±$1.00 (100 cents) amount tolerance,
   - ±3 days `occurred_at` tolerance,
   - merchant-name Jaro-Winkler similarity > 0.8.
3. Exactly one match → link:
   - `email.metadata.matched_transaction_id = <provider.id>`,
     `email.metadata.status = 'shadowed'`.
   - `provider.metadata.email_receipt_id = <email.id>`.
4. More than one match → leave both provider rows untouched and mark
   `email.metadata.status = 'ambiguous_match'` with
   `candidate_transaction_ids` for the UI.
5. Zero matches → no-op.

Audit row per household with match / ambiguous / unmatched counts.

## Current behavior

Today the enrichment pipeline does **not** write
`source='email_receipt'` rows — that cross-cut lands with
`@memory-background` in a follow-up. Until then the reconciler is a
no-op and writes an audit row with zero matches.

## Thresholds

Tunable via constants in `src/handler.ts`:

- `RECONCILE_LOOKBACK_DAYS = 30`
- `AMOUNT_TOLERANCE_CENTS = 100`
- `DATE_TOLERANCE_DAYS = 3`
- `MERCHANT_SIMILARITY_THRESHOLD = 0.8`

Changes should be accompanied by a corresponding spec update in
`specs/03-integrations/budgeting.md`.
