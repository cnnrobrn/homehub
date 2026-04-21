# Graph Schema

**Purpose.** The Postgres tables that implement the memory graph.

**Scope.** `mem.*` schema, node types, edge types, indexes.

## Tables

### `mem.node`
```
id                uuid pk
household_id      uuid
type              text   # see Node Types
canonical_name    text
document_md       text
manual_notes_md   text   # preserved across regeneration
metadata          jsonb
embedding         vector(1536)
created_at        timestamptz
updated_at        timestamptz
needs_review      bool default false
unique (household_id, type, canonical_name)
```

### `mem.alias`
```
id                uuid pk
node_id           uuid → mem.node
alias             text
source            text   # 'manual','extracted','imported'
unique (node_id, alias)
```

### `mem.edge`
```
id                uuid pk
household_id      uuid
src_id            uuid → mem.node
dst_id            uuid → mem.node
type              text   # see Edge Types
weight            real default 1.0
evidence          jsonb  # [{row_table, row_id, excerpt}...]
created_at        timestamptz
updated_at        timestamptz
unique (household_id, src_id, dst_id, type)
```

### `mem.mention`
Links a graph node to the raw row that mentioned it.
```
id                uuid pk
household_id      uuid
node_id           uuid → mem.node
row_table         text
row_id            uuid
first_seen_at     timestamptz
```

### `mem.episode`
A specific event with time and place, enriched from a source row.
```
id                uuid pk
household_id      uuid
title             text
summary           text
occurred_at       timestamptz
ended_at          timestamptz null
place_node_id     uuid → mem.node null
participants      uuid[]            # mem.node ids of people
source_type       text              # 'event','email','meal','transaction','conversation'
source_id         uuid
recorded_at       timestamptz
metadata          jsonb
embedding         vector(1536)
```

### `mem.fact`
An atomic `(subject, predicate, object)` fact with bi-temporal columns. See [`temporal.md`](./temporal.md) and [`extraction.md`](./extraction.md).
```
id                uuid pk
household_id      uuid
subject_node_id   uuid → mem.node
predicate         text              # controlled vocabulary
object_value      jsonb             # primitive literal
object_node_id    uuid → mem.node null
confidence        real              # 0..1
evidence          jsonb             # [{source_type, source_id, excerpt, extractor_version}...]
valid_from        timestamptz
valid_to          timestamptz null  # null = still valid
recorded_at       timestamptz
superseded_at     timestamptz null
superseded_by     uuid → mem.fact null
source            text              # 'member','extraction','consolidation','reflection'
reinforcement_count int default 1
last_reinforced_at timestamptz
conflict_status   text check in ('none','parked_conflict','unresolved') default 'none'
```

Index: `(household_id, subject_node_id, predicate) where valid_to is null` — the hot "currently true" lookup.

### `mem.fact_candidate`
Holds extracted facts awaiting reconciliation; same shape as `mem.fact` but with no effect on retrieval until promoted.

### `mem.pattern`
Detected procedural regularities.
```
id                uuid pk
household_id      uuid
kind              text              # 'temporal','co_occurrence','threshold'
description       text
parameters        jsonb             # structured pattern params
confidence        real
sample_size       int
observed_from     timestamptz
observed_to       timestamptz
last_reinforced_at timestamptz
status            text check in ('active','decayed','archived')
```

### `mem.rule`
Member-authored household rules.
```
id                uuid pk
household_id      uuid
author_member_id  uuid → app.member
description       text
predicate_dsl     jsonb             # structured representation for runtime evaluation
created_at        timestamptz
active            bool default true
```

### `mem.insight`
Output of weekly reflection; not canonical fact but visible and promotable.
```
id                uuid pk
household_id      uuid
week_start        date
body_md           text
promoted_to_rule_id uuid → mem.rule null
```

## Indexes

```
create index on mem.node (household_id, type);
create index on mem.node using gin (metadata);
create index on mem.node using ivfflat (embedding vector_cosine_ops);
create index on mem.alias (lower(alias) text_pattern_ops);
create index on mem.edge (household_id, src_id, type);
create index on mem.edge (household_id, dst_id, type);
create index on mem.mention (row_table, row_id);
create index on mem.episode (household_id, occurred_at desc);
create index on mem.episode using ivfflat (embedding vector_cosine_ops);
create index on mem.fact (household_id, subject_node_id, predicate) where valid_to is null;
create index on mem.fact (household_id, superseded_at) where superseded_at is not null;
create index on mem.pattern (household_id, status);
```

## Node types (v1)

| Type        | Canonical name example     | Notes                                      |
|-------------|----------------------------|--------------------------------------------|
| `person`    | "Mom", "Priya Martin"      | Maps to `app.person` when there's a row    |
| `place`     | "Harvard Sq Trader Joe's"  | Distinct from merchant                      |
| `merchant`  | "Trader Joe's"             | Brand/chain; linked to places via `has_location` |
| `dish`      | "Chicken Tikka Masala"     | Recipe-ish; edges to ingredients           |
| `ingredient`| "Paneer"                   | Basic food units                           |
| `topic`     | "Leo's soccer season"      | Free-form project/theme                    |
| `event_type`| "Birthday", "Date night"   | Recurring kinds                            |
| `subscription` | "Netflix"               | For financial-segment tracking             |
| `account`   | "Joint Checking"           | Shadows `app.account` in the graph         |
| `category`  | "Groceries"                | Canonical spending/meal/social categories   |

Types are enumerated in code (`packages/shared/memory/node-types.ts`); adding a type is a normal PR with a migration and a prompt update.

## Edge types (v1)

| Type              | Semantics                                   |
|-------------------|---------------------------------------------|
| `attended`        | person attended event                       |
| `ate`             | person ate dish                             |
| `contains`        | dish contains ingredient                    |
| `cooked`          | person cooked meal                          |
| `paid`            | account paid transaction                    |
| `purchased_at`    | transaction happened at merchant            |
| `located_at`      | merchant has place                          |
| `related_to`      | topic relates to person / event / place     |
| `prefers`         | person prefers attribute                    |
| `avoids`          | person avoids attribute (allergen, dislike) |
| `recurs`          | event recurs on schedule                    |
| `part_of`         | event is part of a topic                    |

Edges carry `weight` so the frequency of "Alice attended Dinner-with-Garcias" accumulates rather than spawning duplicate edges.

## Raw-row linkage via `mem.mention`

`mem.edge` is node-to-node. Tracing back to the specific transaction/email/meal that produced a fact uses `mem.mention`. This separation keeps the graph thin while still supporting "show me the receipt that taught you this."

## RLS

Same template as `app.*` — household-scoped (see [`../02-data-model/row-level-security.md`](../02-data-model/row-level-security.md)).

## Dependencies

- [`concept.md`](./concept.md)
- [`enrichment-pipeline.md`](./enrichment-pipeline.md)
- [`retrieval.md`](./retrieval.md)

## Open questions

- Do we ever materialize a node's neighborhood for fast retrieval (e.g., a pre-joined `node_neighborhood` view)? Not needed at household scale; revisit if graphs exceed ~100k nodes.
- Versioning node documents: keep a `mem.node_revision` history table? Useful for debugging model drift. Leaning yes, minimal columns.
