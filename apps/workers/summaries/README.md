# @homehub/worker-summaries

Writes weekly + monthly summaries into `app.summary`.

- **Owner:** @memory-background
- **Spec:** `specs/05-agents/summaries.md`, `specs/06-segments/financial/summaries-alerts.md`

## What this service ships (M5-B)

Two entries:

- `src/main.ts` — long-running HTTP server (`/health`, `/ready`). No poll
  loop; summaries are cron-driven.
- `src/cron.ts` — one-shot pass. Computes the covered window for the
  requested period, loads transactions / accounts / budgets + prior
  period spend, calls `renderFinancialSummary`, inserts an `app.summary`
  row with `model='deterministic'`, audits `summary.financial.generated`.

### Idempotency

Skips when an `app.summary` row already exists for
`(household_id, segment='financial', period, covered_start)`.

### Empty households

Still produce a summary — the body reads "No financial activity in this
period." — so the UI's digest timeline has a row for every period.

## Railway cron schedule

```
0 4 * * 1    # Mondays 04:00 UTC  → pnpm cron --period=weekly
0 5 1 * *    # 1st of month 05:00 UTC → pnpm cron --period=monthly
```

Operator one-shots:

```
pnpm cron --period=weekly
pnpm cron --period=monthly --household=<uuid>
```

`--period` can also be provided via `HOMEHUB_SUMMARIES_PERIOD` env.

## Renderer

Deterministic TypeScript. Lives in `packages/summaries/src/financial.ts`.
Output = markdown body (~ 20 lines) + structured `metrics` blob with
`totalSpendCents`, `totalIncomeCents`, `biggestCategory`,
`biggestTransaction`, `accountHealth[]`, `vsPriorPeriodPct`,
`budgetProgress[]`. Audit row stores the full metrics blob.

## Env

Standard worker runtime. No Nango, no model keys — renderer is pure.
