---
name: social
description: Read and update people, relationships, groups, birthdays, and reciprocity. Use when the user asks about a family member, friend, group, birthday, "when did we last see …", or wants to log a touchpoint (call, visit, gift).
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, social, people]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
---

# Social

See `_shared`. Tables: `app.person` (canonical), `mem.node` with
`node_type='person'` (graph identity). Birthdays project into
`app.event` via the social-materializer worker.

## When to Use

- Who is X? When is their birthday?
- "We haven't seen the Johnsons in a while" — reciprocity read.
- Logging a touchpoint (visit, call, gift).
- Group membership questions.

## Read

```bash
# People directory
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/person?household_id=eq.$HOUSEHOLD_ID&order=display_name.asc"
```

## Write

- **Prefer the memory skill** for touchpoints: a "saw aunt Jane today"
  is a `mem.fact` with a `person` node reference, not a raw `app.person`
  edit.
- Direct `app.person` edits (correcting a name, adding a birthday) are
  fine, but note the materializer needs to refresh derived rows — flag
  when the change won't be visible immediately.

## Pitfalls

- `app.person` != `app.member`. Members are connected household users;
  people are the broader relationship graph.
- Birthdays on `app.person` are stored as `mm-dd` (no year); the event
  projection adds the year. Don't invent year values.
- Group membership uses a join table — grep migrations for the exact
  name; don't assume `group_member`.
