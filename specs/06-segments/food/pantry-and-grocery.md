# Pantry & Grocery

**Purpose.** How the household tracks what it has, decides what to buy, and closes the loop when orders arrive.

## Pantry

`app.pantry_item` rows represent inventory the household currently has.

- Fields: name, quantity, unit, location (fridge/freezer/pantry), expiration, last-seen.
- Updates come from three sources:
  1. **Grocery order completion** — received items auto-increment quantities.
  2. **Manual entry** — member adds/edits via UI or a quick "scan-a-receipt" flow.
  3. **Meal cooking** — when a `meal.status` flips to `cooking`, ingredient quantities can be decremented (opt-in; default off because estimation is error-prone).

### Staples

Members can flag certain pantry items as **staples** (coffee, olive oil, salt). Staples are monitored even when not tied to a planned meal; `low_staple` alerts fire when quantity hits zero.

### Expiration

- Default expiration heuristics per ingredient class (produce: 7 days; dairy: varies; pantry dry: 90+).
- Manual override on create.
- `pantry_expiring` alert fires based on `expires_on`.

## Grocery lists

`app.grocery_list` is a draft or placed order. Lifecycle: `draft → ordered → received | cancelled`.

### Draft generation

The **pantry-diff** worker computes the week's required ingredients as:

```
required = Σ (meal.servings × dish.ingredients_per_serving for meals in [now, window_end])
pantry_covers = sum of matching pantry items
grocery_list = required - pantry_covers - already-on-list
```

Drafts stay in `draft` until a member approves. Multiple household members can add items before placement.

### SKU resolution

Each list item resolves to a provider SKU via the grocery adapter (see [`../../03-integrations/grocery.md`](../../03-integrations/grocery.md)). Resolution is cached per `(household, ingredient_or_item, provider)` so repeat orders don't re-prompt.

### Placement

- One member "places" the order, which creates an `action` and routes through the provider.
- On placement: `status = 'ordered'`, `external_order_id` populated.
- On receipt: `status = 'received'`, pantry quantities increment.

### Failures

- Provider error → action fails, list stays in `ordered` with an error flag and CTA to retry or fall back to export.
- Partial fulfillment / substitutions are reflected in `grocery_list_item.received_quantity` + `received_as` (if substituted).

## Waste tracking

`pantry_expiring` alerts that resolve without the item being consumed (pantry decrement) are counted as waste events. Monthly summary reports waste in dollar terms.

## Dependencies

- [`meal-planning.md`](./meal-planning.md)
- [`../../03-integrations/grocery.md`](../../03-integrations/grocery.md)

## Open questions

- Barcode scanning (via mobile): post-v1.
- Exact pantry unit normalization (1 can vs. 14oz vs. 400g): initial model tolerates rough equivalence; hard normalization is a rabbit hole we defer.
