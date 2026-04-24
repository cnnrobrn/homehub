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
Use the `homehub` CLI.

## When to Use

- Who is X? When is their birthday?
- "We haven't seen the Johnsons in a while" — reciprocity read.
- Logging a touchpoint (visit, call, gift).
- Group membership questions.

## Read

```bash
# People directory
homehub social people list
homehub social people list --query Jane
homehub memory nodes search --type person --query Jane
```

## Write

- **Prefer the memory skill** for touchpoints: a "saw aunt Jane today"
  is a `mem.fact_candidate` with a `person` node reference, not a raw
  `app.person` edit. Use `homehub memory fact-candidates add`.
- Direct `app.person` edits (correcting a name, adding a birthday) are
  fine, but note the materializer needs to refresh derived rows — flag
  when the change won't be visible immediately.

```bash
homehub social people add --name "Jane Garcia" --relationship friend
homehub memory fact-candidates add \
  --subject-node-id "$PERSON_NODE_ID" \
  --predicate last_seen \
  --object-text "Visited on 2026-04-24"
```

## Pitfalls

- `app.person` != `app.member`. Members are connected household users;
  people are the broader relationship graph.
- Birthdays on `app.person` are stored as `mm-dd` (no year); the event
  projection adds the year. Don't invent year values.
- Group membership uses a join table — grep migrations for the exact
  name; don't assume `group_member`.
