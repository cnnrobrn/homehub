# Food — Suggestions & Coordination

## Suggestions (catalog)

| Kind                      | Trigger                                                                  |
|---------------------------|--------------------------------------------------------------------------|
| `meal_swap`               | Expiring pantry item; propose a swap to a dish that uses it              |
| `generate_grocery_order`  | Week's planned meals vs. pantry; draft a list                            |
| `new_dish_for_variety`    | Repetition threshold hit; propose 3 candidate dishes informed by household preferences |
| `restock_staple`          | A flagged staple (coffee, olive oil, etc.) is low or missing             |
| `prep_ahead`              | Heavy weekday cook night; propose a Sunday prep step                     |

## Coordination

### Who cooks

Each `meal` has an optional `cook_member_id`. When unassigned, a coordination prompt appears a few hours before the slot asking who's cooking. Members can claim; can pass to another; can convert to takeout.

### Grocery-run coordination

When a grocery list is drafted, it's visible to all Food-segment members. Any member can add items before placing. A single member finalizes and places via the provider.

### Dinner-guest coordination

If a Social event of kind "hosting dinner" lands with attendees, a coordination card appears: "Cook for N. Known preferences / avoids: …" Data pulled from each attendee's `person` node (from prior visits) — this is one of the highest-leverage uses of the memory graph.

## Execution

- `place_grocery_order` — routed through the grocery provider adapter.
- `add_meal_to_plan` — direct write, no approval needed (low-stakes).
- `update_pantry` — direct write.
- `draft_shopping_export` — creates a shareable list when no provider API exists.

## Dependencies

- [`meal-planning.md`](./meal-planning.md)
- [`pantry-and-grocery.md`](./pantry-and-grocery.md)
- [`../../03-integrations/grocery.md`](../../03-integrations/grocery.md)
