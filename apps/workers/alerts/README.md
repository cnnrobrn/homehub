# @homehub/worker-alerts

Emits alerts into `app.alert` from deterministic detectors.

- **Owner:** @memory-background
- **Spec:** `specs/05-agents/alerts.md`, `specs/06-segments/financial/summaries-alerts.md`

## What this service ships (M5-B)

Two entries:

- `src/main.ts` — long-running HTTP server (`/health`, `/ready`). No poll
  loop; alerts are cron-driven. The process stays alive so Railway has
  stable logs and a readiness target.
- `src/cron.ts` — one-shot pass. Runs the subscription detector +
  seven financial alert detectors for every household, then exits.

### Financial detectors

| Detector                      | Severity        | Dedupe key                      |
| ----------------------------- | --------------- | ------------------------------- |
| `budget_over_threshold`       | warn / critical | `${budgetId}:${periodStartDay}` |
| `payment_failed`              | critical        | `${transactionId}`              |
| `large_transaction`           | info            | `${transactionId}`              |
| `subscription_price_increase` | warn            | `${subId}:${YYYY-MM}`           |
| `account_stale`               | warn            | `${accountId}`                  |
| `duplicate_charge`            | warn            | `${laterTransactionId}`         |
| `new_recurring_charge`        | info            | `${subscriptionNodeId}`         |

Each detector lives in `packages/alerts/src/financial/*.ts` and is unit
tested against fixtures.

### Subscription detector pre-step

Runs before the alert detectors. Takes last-90d transactions, groups by
normalized merchant, and when ≥ 3 charges are within ±5% of the median
and the median inter-charge gap matches weekly / monthly / yearly (with
tolerances), it upserts a `mem.node` of type `subscription` and tags
matched transactions with `metadata.recurring_signal`. New nodes trigger
a `node_regen` enqueue and feed the `new_recurring_charge` alerter.
Member-confirmed nodes (`needs_review=false` and present before this
run) are never overwritten.

## Dedupe semantics

Alerts dedupe at the application layer via
`(household_id, kind, dedupeKey)` within a 24h window. Because
`app.alert` does not currently have `kind` / `dedupe_key` columns, the
worker stashes them in `context.alert_kind` + `context.alert_dedupe_key`.
A follow-up migration adding dedicated columns is requested in the M5-B
report.

## Railway cron schedule

```
0 6 * * *    # daily 06:00 UTC   → pnpm cron
```

Operator one-shots:

```
pnpm cron                                   # all households
pnpm cron --household=<uuid>                # restrict to one household
pnpm cron --household=<uuid> --household=...  # restrict to many
```

## Env

Standard worker runtime (`workerRuntimeEnvSchema`): Supabase service key,
URL, logging, OTel. No Nango, no model keys — detectors are pure.

## Follow-ups

- Migration adding `kind` + `dedupe_key` columns to `app.alert` (tracked
  in the M5-B review report).
- Quiet-hours delivery for email/push (non-blocking; in-app only in v1).
