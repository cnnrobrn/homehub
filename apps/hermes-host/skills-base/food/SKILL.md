---
name: food
description: Read and write meal plans, pantry inventory, grocery lists, dishes, and Instacart grocery handoffs. Use when the user asks "what's for dinner", "add eggs to groceries", "what's in the pantry", "plan meals this week", "send this to Instacart", or anything food-related. Most food writes are direct (low-stakes); checkout links and big swaps should still go through HomeHub suggestions/UI.
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
`grocery_list.external_url` stores provider checkout/deep-link URLs,
including Instacart shopping-list links.

## When to Use

- Meal plan questions ("what's dinner Thursday?").
- Pantry read/write ("do we have rice?", "add 2 onions to the pantry").
- Grocery list management.
- Instacart handoff requests ("order these groceries", "send to
  Instacart").
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

# Recent grocery lists, including Instacart URL when present
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/grocery_list?household_id=eq.$HOUSEHOLD_ID&select=id,planned_for,status,provider,external_url,updated_at&order=updated_at.desc&limit=10"
```

## Write (direct — low-stakes)

Adding/removing pantry items, scheduling meals, creating HomeHub grocery
drafts, and checking groceries off the list: write directly. Upsert
pattern for meals uses the composite conflict target
`(household_id, planned_for, slot)`:

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

Checkout-like grocery requests ("place the order", "send this to
Instacart"), delivery commitments, and expensive bulk swaps: propose via
`app.suggestion` with `segment='food'` and `kind='propose_grocery_order'`.
Use `preview.provider='instacart'` when the user specifically asks for
Instacart.

```bash
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -d "{\"household_id\":\"$HOUSEHOLD_ID\",\"segment\":\"food\",\"kind\":\"propose_grocery_order\",\"title\":\"Send groceries to Instacart\",\"rationale\":\"Needs approval before checkout handoff.\",\"preview\":{\"planned_for\":\"2026-04-25\",\"provider\":\"instacart\",\"items\":[{\"name\":\"Milk\",\"quantity\":1,\"unit\":\"gallon\"}]},\"status\":\"pending\"}" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/suggestion"
```

The sandbox does **not** have the Instacart API key. Do not call
Instacart directly and do not tell the user to connect Instacart in
settings. HomeHub server code creates `external_url`; the user signs in
and checks out on Instacart after opening that URL.

## Pitfalls

- Pantry `unit` is free text, but keep it simple and reusable (`each`,
  `cup`, `lb`, `oz`, `gallon`) so pantry diffing and Instacart matching
  work.
- Grocery items use `checked` as a boolean; older notes may mention
  `checked_at`, but the current table has `checked`.
- `external_url` is a provider handoff URL. Treat it as user-facing, not
  a secret, but don't invent one.
- Meal `slot` is typically `breakfast|lunch|dinner|snack` — confirm the
  set from an existing row before assuming.
