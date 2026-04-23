---
name: calendar
description: Read and write household calendar events. Use when the user mentions scheduling, events, appointments, reminders, "my calendar", "what's next", or when a turn should produce or modify a dated item.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, calendar]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
    required_for: all queries
  - name: HOMEHUB_SUPABASE_URL
    required_for: database access
  - name: HOMEHUB_SUPABASE_ANON_KEY
    required_for: PostgREST apikey header
  - name: HOMEHUB_SUPABASE_JWT
    required_for: household-scoped Authorization bearer
---

# Calendar

See `_shared` for auth/scoping rules. **Always filter by `household_id`.**

## When to Use

- User asks what's on the calendar, today/week/month, upcoming events.
- User wants to add, move, cancel, or summarize an event.
- Another skill needs to surface a date-bound item.

## Read

```bash
# Next 7 days
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/event?household_id=eq.$HOUSEHOLD_ID&starts_at=gte.$(date -u +%FT%TZ)&order=starts_at.asc&limit=50"
```

Key columns: `id`, `title`, `starts_at`, `ends_at`, `source`, `notes`.
Source is one of `manual`, `gcal`, `financial`, `food`, `fun`, `social`.

## Write

```bash
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"household_id\":\"$HOUSEHOLD_ID\",\"title\":\"$TITLE\",\"starts_at\":\"$START_ISO\",\"ends_at\":\"$END_ISO\",\"source\":\"manual\"}" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/event"
```

## Pitfalls

- `source` is check-constrained. Don't invent values — stick to the
  enum above.
- Events with `source != 'manual'` are produced by other skills/workers.
  Don't edit them directly; update the origin (financial transaction,
  meal, person) instead.
- Timezones: `starts_at`/`ends_at` are `timestamptz`. Send UTC ISO.

## Suggesting (not executing)

For anything that looks like a commitment (booking, reservation), prefer
writing to `app.suggestion` with `segment='fun'` or the relevant
segment and `status='pending'`. The family approves in `/suggestions`.
