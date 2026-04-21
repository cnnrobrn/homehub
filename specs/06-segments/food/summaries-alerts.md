# Food — Summaries & Alerts

## Summaries

### Weekly (Monday)
- Meals cooked vs. planned (completion rate).
- Dominant cuisines / repetition warnings.
- Grocery spend vs. food budget.
- Expired / wasted pantry items.
- Preview of next week's plan.

### Monthly
- Top dishes.
- Eating-out vs. cooking ratio.
- Cost per meal trend.
- Pantry stockout frequency (items that ran out and required a mid-week run).

## Alerts

| Detector               | Severity | Trigger                                    |
|------------------------|----------|--------------------------------------------|
| `pantry_expiring`      | info/warn | 3 days / 1 day out                         |
| `meal_plan_gap`        | info     | Upcoming slot within 48h has no meal       |
| `grocery_order_issue`  | warn     | Substitution or out-of-stock detected      |
| `repeated_dish`        | info     | Same dish 3+ times in 7 days               |
| `low_staple`           | info     | Designated staple pantry item at 0         |

## Notes on context

Alerts tied to specific nodes link to them — e.g., `pantry_expiring` links to the `mem.node type=ingredient` so the UI can show "which meals could use this."

## Dependencies

- [`../../05-agents/summaries.md`](../../05-agents/summaries.md)
- [`../../05-agents/alerts.md`](../../05-agents/alerts.md)
