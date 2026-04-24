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
Use the `homehub` CLI; it injects household scope.

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
homehub food meals list --from "$(date -u +%F)"

# Current pantry
homehub food pantry list

# Recent grocery lists and items
homehub food groceries list --limit 10
```

## Write (direct — low-stakes)

Adding/removing pantry items, scheduling meals, creating HomeHub grocery
drafts, and checking groceries off the list: write directly. Upsert
pattern for meals uses the composite conflict target
`(household_id, planned_for, slot)`:

```bash
homehub food meals add --planned-for 2026-04-25 --slot dinner --title "$DISH"
homehub food pantry add --name eggs --quantity 12 --unit count --location fridge
homehub food groceries create --status draft
homehub food groceries add-item --list-id "$LIST_ID" --name milk --quantity 1 --unit gallon
```

## Write (via suggestion)

Checkout-like grocery requests ("place the order", "send this to
Instacart"), delivery commitments, and expensive bulk swaps: create a
pending suggestion:

```bash
homehub suggestions create \
  --segment food \
  --kind propose_grocery_order \
  --title "Review grocery order" \
  --rationale "$WHY" \
  --preview-json "$PREVIEW_JSON"
```

Use `preview.provider='instacart'` when the user specifically asks for
Instacart.

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
