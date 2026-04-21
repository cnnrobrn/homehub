# Runbook — household model-budget breach

**Trigger:** alert "Household hitting model budget ceiling" or a
member reporting degraded enrichment.

## 1. Confirm scope

From `/ops/model-usage` (owner-only), the budget bar shows MTD spend
against the configured cap. The per-task table ranks tasks by cost;
the top entries are usually the culprits.

Per-household, check:

- The MTD cost vs. the configured budget (`household.settings.memory.model_budget_monthly_cents`).
- Which tasks dominate. Usual suspects, in rough order:
  - `enrichment.event` / `enrichment.email` spikes during a large
    initial sync.
  - `reflection.weekly` is cheap per run but can compound if a cron
    re-runs a week.
  - `foreground.chat` dwarfs the rest during a heavy usage day.

## 2. Short-term mitigations

- `withBudgetGuard()` in the worker runtime already skips new model
  calls once the budget is exhausted. Confirm the guard is tripping
  by searching logs for `budget_exceeded`.
- For recurring crons (reflection, summaries), verify only one instance
  is enabled. A duplicated cron is a classic cause.

## 3. Long-term mitigations

- Raise the budget: `household.settings.memory.model_budget_monthly_cents`.
  The setting is owner-writable via the household settings page.
- Optimize the dominant task:
  - Shrink the prompt (`packages/prompts`).
  - Increase cache-hit rate (prompt cache / KV cache).
  - Gate on a cheaper pre-check (e.g. only route to a big model when
    a classifier above a threshold).

## 4. Escalation

- If the household is a preview / demo and cost is unexpected, pause
  the offending worker for that household by setting
  `app.household.settings.memory.enrichment_paused = true` (feature
  flag read at the top of each worker handler).
- If the spike is caused by a bug (infinite loop, re-enqueue storm),
  scale the worker to 0, investigate with the logs + audit events,
  fix, then redeploy.

## 5. Post-incident

- Update [`specs/10-operations/observability.md`](../../../specs/10-operations/observability.md)
  thresholds if the alert fired too late.
- Capture the root cause in the incident log.
