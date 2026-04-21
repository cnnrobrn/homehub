# Food — Overview

**Purpose.** Everything HomeHub does around meals and groceries.

**Scope.** The data model, the slices, and the specialized subsystems (meal planning, pantry, grocery).

## Core entities

- `app.meal` — planned or cooked meals.
- `app.pantry_item` — inventory the household has on hand.
- `app.grocery_list`, `app.grocery_list_item` — draft and placed orders.
- `mem.node type=dish`, `type=ingredient`, `type=merchant` (grocery stores, restaurants).

## The loop

```
meal plan → grocery diff → grocery order → pantry update → meal plan …
```

Food is the most mechanical of the four segments: there's a clear closed loop, and most of the value is in automating that loop end-to-end.

## What we own

- A **weekly meal plan** editable by the household.
- A **pantry inventory** that updates automatically from grocery orders and manually from the member.
- A **grocery list** derived from (meal plan − pantry), with provider-ordering integration.
- A **dish/ingredient memory graph** that tracks preferences, allergens, repetition, and cost.

## What we don't own

- **Recipe content.** We surface pointers (URLs, notes) and extract ingredient lists via enrichment, but we don't host a recipe database. Members can link out.
- **Nutrition authority.** Nutrition metadata is best-effort via a free food-data API.

## Specialized docs

- [`meal-planning.md`](./meal-planning.md)
- [`pantry-and-grocery.md`](./pantry-and-grocery.md)

## The three slices

- [`calendar.md`](./calendar.md)
- [`summaries-alerts.md`](./summaries-alerts.md)
- [`suggestions-coordination.md`](./suggestions-coordination.md)

## Open questions

- Do we track restaurant/takeout as "meals" too? Yes — same table, `source = 'takeout'`. Informs variety and spend.
- Multi-household cooking (e.g., a member cooks for their parents' household too): out of scope.
