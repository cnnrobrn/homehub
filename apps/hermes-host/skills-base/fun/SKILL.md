---
name: fun
description: Read and manage trips, outings, queued activities, and fun events. Use when the user talks about activities, things to do, trips, vacations, date nights, kids' activities, weekend plans. Bookings and reservations go through suggestions.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, fun, trips, activities]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
---

# Fun

See `_shared`. Fun items live in `app.event` with `source='fun'` today;
confirm whether a dedicated `trip`/`queue_item` table exists before
assuming (grep migrations).

## When to Use

- Trip planning, outing ideas, queue ("things we want to do").
- Upcoming fun events on the calendar.
- Suggestions for activities given a weekend / budget.

## Read

```bash
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/event?household_id=eq.$HOUSEHOLD_ID&source=eq.fun&order=starts_at.asc&limit=50"
```

## Write

- Low-stakes queue additions ("want to try this restaurant"): direct
  write to the fun table with `status='queued'` (or equivalent).
- Reservations, tickets, deposits: `app.suggestion` with
  `segment='fun'`, `proposed_action` matching `proposeBookReservation`.

## Pitfalls

- Don't double-book — always check existing fun events on the target
  date before proposing.
- Budget check: if the outing has a likely cost, cross-reference
  `financial` skill (budget for `entertainment` category, if present)
  before confirming.
