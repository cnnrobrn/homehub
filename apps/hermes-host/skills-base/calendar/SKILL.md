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

See `_shared` for auth/scoping rules. Use the `homehub` CLI; it injects
household scope.

## When to Use

- User asks what's on the calendar, today/week/month, upcoming events.
- User wants to add, move, cancel, or summarize an event.
- Another skill needs to surface a date-bound item.

## Read

```bash
# Next 7 days
homehub calendar list --from "$(date -u +%FT%TZ)" --limit 50

# Segment-specific
homehub calendar list --segment food --from 2026-04-24T00:00:00Z --to 2026-05-01T00:00:00Z
```

Key columns: `id`, `title`, `starts_at`, `ends_at`, `source`, `notes`.
Source is one of `manual`, `gcal`, `financial`, `food`, `fun`, `social`.

## Write

```bash
homehub calendar add \
  --title "$TITLE" \
  --starts-at "$START_ISO" \
  --ends-at "$END_ISO" \
  --segment social \
  --kind appointment
```

## Pitfalls

- `segment` is check-constrained. Use
  `financial|food|fun|social|system`.
- Provider/imported events are produced by workers. Don't edit them
  directly; update the origin object or create a suggestion.
- Timezones: `starts_at`/`ends_at` are `timestamptz`. Send UTC ISO.

## Suggesting (not executing)

For anything that looks like a commitment (booking, reservation), prefer
writing to `app.suggestion` with `segment='fun'` or the relevant
segment and `status='pending'`. The family approves in `/suggestions`.
