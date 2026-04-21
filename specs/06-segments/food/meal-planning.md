# Meal Planning

**Purpose.** How the household plans what to eat.

**Scope.** The planner UI's data contract, dish resolution, preferences, and constraints.

## Data contract

A `meal` row answers: **when**, **what**, **who cooks**, **how many servings**, **status**.

```
app.meal {
  id, household_id, planned_for date, slot, dish_node_id?,
  title, servings, cook_member_id?, status, notes
}
```

A dish is optional — free-text meals ("leftovers", "pizza night") are allowed. When present, `dish_node_id` resolves to a `mem.node type=dish`.

## Dish resolution

On meal creation:

1. If member picked an existing dish from autocomplete → link directly.
2. If free text → enrichment attempts resolution against existing dishes; creates a new dish node if none match.
3. Dish nodes accumulate ingredients, cuisine, effort score, typical cost, household preference (liked/disliked counts from notes).

## Preferences & constraints

Per-person attributes on `person` nodes:

- `avoids` (allergens, dislikes)
- `prefers` (cuisine, texture, protein)
- `dietary` (vegetarian, halal, etc.)

The planner respects these as filters when suggesting dishes. Hard constraints (allergens) are strict; soft (preferences) re-rank.

## Planning modes

- **Manual** — member picks dish per slot.
- **Assisted** — member sets constraints ("one vegetarian, one quick, one new dish this week"); HomeHub drafts the plan; member approves or edits.
- **Auto-repeat** — copy last week's plan and shift; member diffs.

## Cost and nutrition metadata

- Cost: derived from ingredient unit cost × quantity; updated on grocery-order completion.
- Nutrition: best-effort via a food-data API cached on the dish node; optional for v1 scope.

## Interaction with Social events

When a Social event of kind `hosted_dinner` exists for a date, the planner shows the expected headcount and any attendees' preferences directly on the slot — "cooking for 6, avoid pork (Nadia), no cilantro (Leo)."

## Dependencies

- [`calendar.md`](./calendar.md)
- [`pantry-and-grocery.md`](./pantry-and-grocery.md)
- [`../social/overview.md`](../social/overview.md)

## Open questions

- Multi-slot meals (leftovers that span two dinners) — represent with a `leftover_of` edge between meals, or a single meal with extended `consumed_at[]`? Leaning `leftover_of` edge for simplicity.
- Shared meal planners across households (in-law dinners): out of scope.
