---
name: food
description: Read and write meal plans, pantry inventory, grocery lists, and dishes. Use when the user asks "what's for dinner", "add eggs to groceries", "what's in the pantry", "plan meals this week", or anything food-related. Most food writes are direct (low-stakes); grocery orders and big swaps should still go through suggestions.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, food, meals, pantry, groceries]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
---

# Food

See `_shared`. Tables: `meal`, `pantry_item`, `grocery_list`,
`grocery_list_item`. All `app` schema, all `household_id`-scoped.

## When to Use

- Meal plan questions ("what's dinner Thursday?").
- Pantry read/write ("do we have rice?", "add 2 onions to the pantry").
- Grocery list management.
- Suggesting dishes based on pantry + preferences.

## Read

```bash
# This week's meal plan
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/meal?household_id=eq.$HOUSEHOLD_ID&planned_for=gte.$(date -u +%F)&order=planned_for.asc,slot.asc"

# Current pantry
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/pantry_item?household_id=eq.$HOUSEHOLD_ID&order=name.asc"
```

## Write (direct — low-stakes)

Adding/removing pantry items, scheduling meals, checking groceries off
the list: write directly. Upsert pattern for meals uses the composite
conflict target `(household_id, planned_for, slot)`:

```bash
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "{\"household_id\":\"$HOUSEHOLD_ID\",\"planned_for\":\"2026-04-25\",\"slot\":\"dinner\",\"title\":\"$DISH\"}" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/meal"
```

## Write (via suggestion)

Grocery orders (placing a delivery), expensive bulk swaps: propose via
`app.suggestion` with `segment='food'`.

## Pitfalls

- Pantry `unit` is a check-constrained enum. Don't invent units.
- Grocery `checked_at` is nullable timestamp, NOT a boolean.
- Meal `slot` is typically `breakfast|lunch|dinner|snack` — confirm the
  set from an existing row before assuming.
