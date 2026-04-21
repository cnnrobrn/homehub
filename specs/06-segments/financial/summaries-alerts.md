# Financial — Summaries & Alerts

**Purpose.** The ongoing briefing and warnings for the Financial segment.

**Scope.** What gets summarized, what gets alerted, at what cadence.

## Summaries

### Daily briefing (part of combined morning brief)
- Balance snapshot + delta overnight.
- Bills due today.
- Notable pending transactions.

### Weekly Financial digest (Monday 7am household tz)
- Total spend vs. prior week.
- Top 5 categories.
- Subscriptions renewing this week with amounts.
- Budgets over / at / under pace.
- Anomalies flagged this week.
- Shared-expense balance (if applicable).

### Monthly Financial digest (1st of month)
- Month-over-month spend.
- Savings-rate calculation (if household has enabled income tracking).
- Subscription census (all active, grouped by tier).
- Categories trending up/down over trailing 3 months.
- Suggested next month's watchlist (3 categories worth attention).

All summaries produced by the [`../../05-agents/summaries.md`](../../05-agents/summaries.md) worker with the Financial template.

## Alerts

Derived from categories in [`../../05-agents/alerts.md`](../../05-agents/alerts.md), scoped to Financial:

| Detector                        | Severity | When                                                        |
|---------------------------------|----------|-------------------------------------------------------------|
| `budget_over_threshold`         | warn/critical | 80% = warn, 100% = critical                           |
| `payment_failed`                | critical | Email-detected or provider-flagged                          |
| `large_transaction`             | warn     | Amount > household threshold (default $500)                 |
| `subscription_price_increase`   | warn     | Recurring charge changed > 10%                              |
| `account_stale`                 | warn     | No sync in 48h                                              |
| `duplicate_charge`              | warn     | Two charges same merchant same day within $0.01             |
| `new_recurring_charge`          | info     | First detected instance of a new repeating pattern          |

## Context pointers

Every alert / summary row includes a `context` jsonb with memory-graph pointers (merchant node, account node, transaction ids). This lets the UI link straight to the relevant graph view.

## Dependencies

- [`../../05-agents/summaries.md`](../../05-agents/summaries.md)
- [`../../05-agents/alerts.md`](../../05-agents/alerts.md)

## Open questions

- Income detection: opt-in due to privacy sensitivity. Off by default.
- Should HomeHub compute a "safe to spend this week" number? Useful; leaning yes with clear caveats about its assumptions.
