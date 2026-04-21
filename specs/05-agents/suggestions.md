# Suggestions

**Purpose.** How HomeHub proposes proactive actions in each segment.

**Scope.** Categories, generation cadence, confidence gating, and execution path.

## Categories (v1)

### Financial
- `transfer_funds` — move surplus from checking to savings / emergency fund.
- `cancel_subscription` — unused / duplicate subscription candidate.
- `settle_shared_expense` — roommate / partner balance suggests a settle-up.
- `rebalance_budget` — repeated overshoots in one category + undershoots in another.

### Food
- `meal_swap` — swap a planned meal to use an expiring pantry item.
- `generate_grocery_order` — draft a grocery list for the upcoming week.
- `new_dish_for_variety` — proposes a dish when repetition is high.

### Fun
- `outing_idea` — fills a free weekend block given household preferences.
- `trip_prep` — packing list / pre-trip tasks around an upcoming travel event.
- `book_reservation` — proactive reservation given frequency patterns.

### Social
- `reach_out` — surface a person the household hasn't seen/contacted in their threshold.
- `gift_idea` — drafts a gift proposal tied to an upcoming birthday.
- `host_back` — reciprocity prompt after a hosting imbalance.

## Generation cadence

- Nightly pass per household: the suggestion engine runs a per-segment generator that proposes up to N suggestions.
- Real-time triggers: certain conditions (an expiring pantry item, a balance threshold) can emit a suggestion immediately.
- Deduplication: a suggestion is only created if an equivalent `pending` / recent `rejected` one doesn't already exist.

## Generator structure

Each category has a generator with two parts:

1. **Candidate selection** — a deterministic query that finds rows meeting the category's conditions. Pure SQL. Explainable.
2. **Rationale drafting** — a Kimi prompt that turns the candidate + memory-graph context into a human-readable `rationale` and `preview`.

This split keeps the deterministic "what to propose" logic auditable and the model's role scoped to language.

## Confidence gating

Each suggestion has a `confidence` score from the generator. Suggestions below a category-specific threshold are discarded silently (never shown). Suggestions at or above threshold are written to `app.suggestion` as `pending`.

## Preview payload

Every suggestion stores a `preview` JSON that describes exactly what would happen on approval:

```json
{
  "kind": "transfer_funds",
  "from_account_id": "...",
  "to_account_id": "...",
  "amount_cents": 40000,
  "description": "Transfer $400 to emergency fund"
}
```

The UI renders the preview so the member knows exactly what they're approving. No "just trust the agent" approvals.

## Execution path

See [`approval-flow.md`](./approval-flow.md).

## Lifecycle states

```
pending → approved → executed | failed
pending → rejected | expired
```

- `expired` after 14 days un-acted-upon (configurable per category).
- `failed` preserves the error; member can retry.

## Dependencies

- [`approval-flow.md`](./approval-flow.md)
- [`model-routing.md`](./model-routing.md)
- [`../06-segments/`](../06-segments/) — per-segment catalog detail.

## Open questions

- Ranking across segments on the dashboard: time-decayed score with diversity penalty so the user doesn't see five Financial suggestions in a row. Simple formula documented in code.
- Should rejected suggestions train a household-level classifier that down-ranks similar ones? Post-v1.
