# Database Schema

**Purpose.** The canonical Postgres schema. Every other spec refers to these tables by name.

**Scope.** Tables, key columns, and relationships. Full DDL lives in migrations under `packages/db`.

## Schemas

Postgres schemas (namespaces) organize tables by concern:

- `app.*` — user-visible core tables (household, member, event, transaction, meal, alert, suggestion, action).
- `mem.*` — memory graph tables (node, edge, embedding).
- `sync.*` — integration bookkeeping (provider_connection, sync_cursor, dead_letter).
- `jobs.*` — pgmq-managed queue tables.
- `audit.*` — append-only audit logs.

## Core tables

### `app.household`
```
id              uuid pk
name            text
created_at      timestamptz
created_by      uuid → auth.users
settings        jsonb   # tz, currency, week_start, etc.
```

### `app.member`
```
id              uuid pk
household_id    uuid → app.household
user_id         uuid → auth.users (nullable for non-connected members)
display_name    text
role            text check in ('owner','adult','child','guest','non_connected')
invited_at      timestamptz
joined_at       timestamptz
```

### `app.person`
A person in the memory graph. A `member` is always a `person`; a `person` is not always a `member`.
```
id              uuid pk
household_id    uuid → app.household
member_id       uuid → app.member (nullable)
display_name    text
aliases         text[]
relationship    text   # 'grandparent', 'friend', 'child', etc.
metadata        jsonb
```

### `app.event`
Unified calendar entity. Powers every segment's Calendar slice.
```
id              uuid pk
household_id    uuid → app.household
owner_member_id uuid → app.member (nullable — household-owned events)
segment         text check in ('financial','food','fun','social','system')
kind            text   # 'gcal_event','bill_due','meal','birthday','reservation','subscription_renewal', ...
title           text
starts_at       timestamptz
ends_at         timestamptz (nullable)
all_day         bool
location        text (nullable)
source_id       text   # stable id from upstream
source_version  text   # ETag / version for idempotency
provider        text   # 'gcal','derived','manual'
metadata        jsonb
```

### `app.transaction`
```
id              uuid pk
household_id    uuid
member_id       uuid → app.member (nullable — unknown attribution)
occurred_at     timestamptz
amount          numeric(14,2)
currency        char(3)
merchant_raw    text
merchant_node_id uuid → mem.node (nullable, resolved in enrichment)
category        text
account_id      uuid → app.account
source          text   # 'monarch','plaid','email_receipt','manual'
source_id       text
source_version  text
metadata        jsonb
```

### `app.account`
Financial account (checking, credit card, etc.).
```
id              uuid pk
household_id    uuid
owner_member_id uuid → app.member
kind            text check in ('checking','savings','credit','investment','loan','cash')
name            text
provider        text
external_id     text
balance_cents   bigint
currency        char(3)
last_synced_at  timestamptz
```

### `app.budget`
```
id              uuid pk
household_id    uuid
name            text
period          text check in ('monthly','weekly','yearly')
category        text
amount_cents    bigint
```

### `app.meal`
```
id              uuid pk
household_id    uuid
planned_for     date
slot            text check in ('breakfast','lunch','dinner','snack')
dish_node_id    uuid → mem.node (nullable)
title           text
servings        int
cook_member_id  uuid → app.member (nullable)
status          text check in ('planned','cooking','served','skipped')
notes           text
```

### `app.pantry_item`
```
id              uuid pk
household_id    uuid
name            text
quantity        numeric
unit            text
expires_on      date (nullable)
location        text   # 'fridge','freezer','pantry'
last_seen_at    timestamptz
```

### `app.grocery_list`
```
id              uuid pk
household_id    uuid
planned_for     date
status          text check in ('draft','ordered','received','cancelled')
provider        text (nullable)   # 'instacart', ...
external_order_id text
```

### `app.grocery_list_item`
```
id              uuid pk
list_id         uuid → app.grocery_list
name            text
quantity        numeric
unit            text
source_meal_id  uuid → app.meal (nullable)
checked         bool
```

### `app.alert`
```
id              uuid pk
household_id    uuid
segment         text
severity        text check in ('info','warn','critical')
title           text
body            text
generated_by    text   # worker name
generated_at    timestamptz
dismissed_at    timestamptz (nullable)
dismissed_by    uuid → app.member (nullable)
context         jsonb   # pointers into memory graph
```

### `app.suggestion`
```
id              uuid pk
household_id    uuid
segment         text
kind            text   # 'transfer_funds','meal_swap','reach_out','add_to_calendar'
title           text
rationale       text
preview         jsonb   # what the suggestion would do
status          text check in ('pending','approved','rejected','executed','expired')
created_at      timestamptz
resolved_at     timestamptz (nullable)
resolved_by     uuid → app.member (nullable)
```

### `app.action`
```
id              uuid pk
household_id    uuid
suggestion_id   uuid → app.suggestion (nullable — member-initiated)
kind            text
payload         jsonb
status          text check in ('pending','running','succeeded','failed')
started_at      timestamptz (nullable)
finished_at     timestamptz (nullable)
error           text (nullable)
result          jsonb (nullable)
```

### `app.summary`
Periodic digests.
```
id              uuid pk
household_id    uuid
segment         text
period          text   # 'daily','weekly','monthly'
covered_start   timestamptz
covered_end     timestamptz
body_md         text
generated_at    timestamptz
model           text
```

## Memory tables

See [`../04-memory-network/graph-schema.md`](../04-memory-network/graph-schema.md) for the full schema under `mem.*`. Summary:

- `mem.node(id, household_id, type, canonical_name, document_md, embedding vector, metadata jsonb)`
- `mem.edge(id, household_id, src_id, dst_id, type, weight, metadata)`
- `mem.alias(id, node_id, alias_text)`

## Sync tables

- `sync.provider_connection(id, household_id, member_id, provider, nango_connection_id, status, last_synced_at)`
- `sync.cursor(id, connection_id, kind, value, updated_at)` — provider-specific sync checkpoints.
- `sync.dead_letter(id, connection_id, payload, error, received_at)` — anything we couldn't normalize.

## Audit

- `audit.event(id, household_id, actor_user_id, action, resource_type, resource_id, before, after, at)` — append-only log for anything mutating data or spending money.

## Indexes worth calling out

- `app.event (household_id, starts_at)` covering index for the unified calendar.
- `app.transaction (household_id, occurred_at desc)` for the ledger.
- `mem.node (household_id, type)` + GIN on `metadata`, IVFFlat on `embedding`.
- Partial index on `app.suggestion (household_id) where status = 'pending'` — the hottest read.

## Dependencies

- [`households.md`](./households.md) — membership and invitations.
- [`row-level-security.md`](./row-level-security.md) — RLS policies applied on top.
- [`../04-memory-network/graph-schema.md`](../04-memory-network/graph-schema.md) — the `mem.*` schema in detail.

## Open questions

- Should `app.event` be partitioned by month? Not until volume justifies it.
- Do we model shared vs. personal accounts (e.g. in Okonkwo-roommate households) via a segment-grant table or via per-row visibility flags? See [`households.md`](./households.md).
