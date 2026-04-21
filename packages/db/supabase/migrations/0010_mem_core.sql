-- Migration: 0010_mem_core.sql
-- Authored: 2026-04-20
-- Purpose: install the memory-graph "skeleton" — mem.node + mem.alias +
--          mem.edge + mem.mention + mem.episode — with RLS, helper
--          triggers, and the indexes called for by
--          specs/04-memory-network/graph-schema.md.
-- Owner: @infra-platform
-- Spec: specs/04-memory-network/graph-schema.md and
--       specs/04-memory-network/concept.md.
--
-- This is M3-A's first migration. A follow-up, 0011_mem_facts_patterns_rules.sql,
-- installs the fact / fact_candidate / pattern / rule / insight tables on
-- top of this one.
--
-- RLS stance, condensed:
--   - Every mem.* table is `enable row level security` + `force row level security`.
--   - Reads are gated by `app.is_member(household_id)` (household membership).
--   - Writes are service-role only by default — the extraction / reconciler
--     workers (M3-B) mutate the graph. Two narrow exceptions here:
--       * mem.node: members may UPDATE the human-curated columns
--                   `manual_notes_md` and `needs_review`. Full INSERT / DELETE
--                   of nodes stays service-role only so the graph topology
--                   is worker-owned.
--       * mem.alias: members may INSERT manual aliases (source = 'manual').
--                    UPDATE / DELETE remain service-role only.
--
-- Trigger choices:
--   - mem.node + mem.edge: BEFORE UPDATE sets updated_at = now().
--   - mem.alias: BEFORE INSERT backfills household_id from the linked node
--     if the caller omitted it (safety net for M3-B workers that currently
--     insert alias rows from within the node's transactional context).
--
-- pgvector choices:
--   - `vector(1536)` — the retrieval layer targets OpenAI text-embedding-3-small
--     (1536 dims) for M3; if the enrichment pipeline later swaps to a smaller
--     model we ship a corrective migration.
--   - ivfflat with lists=100 — reasonable for the <100k rows/household scale
--     M3 targets. graph-schema.md flags revisiting this at scale; the open
--     question is tracked there.
--
-- Idempotency: `create table if not exists`, `create index if not exists`,
-- `create or replace function`, and `drop policy if exists` before create
-- keep the migration safe to re-run against a partial apply.

-- --------------------------------------------------------------------------
-- mem.node
-- --------------------------------------------------------------------------
-- A canonical household-scoped entity (person, place, dish, etc.). The
-- embedding column is the vector representation of canonical_name +
-- document_md that `retrieval.md` uses for cosine-distance lookups.
--
-- (household_id, type, canonical_name) is unique so the reconciler's
-- "canonicalize name" step has a single-row target to upsert into. The
-- node_types.ts enum in packages/shared mirrors the `type` check
-- constraint — adding a type is always a `check` amendment + a shared
-- enum amendment in the same PR.
create table if not exists mem.node (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references app.household(id) on delete cascade,
  type             text not null check (type in (
    'person','place','merchant','dish','ingredient','topic',
    'event_type','subscription','account','category'
  )),
  canonical_name   text not null,
  document_md      text,
  manual_notes_md  text,
  metadata         jsonb not null default '{}'::jsonb,
  embedding        vector(1536),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  needs_review     boolean not null default false,
  unique (household_id, type, canonical_name)
);

alter table mem.node enable row level security;
alter table mem.node force row level security;

create index if not exists mem_node_household_type_idx
  on mem.node (household_id, type);

create index if not exists mem_node_metadata_gin_idx
  on mem.node using gin (metadata);

-- ivfflat ANN index for cosine-distance lookups. `lists=100` matches the
-- open-question default in graph-schema.md; revisit at >100k nodes/household.
create index if not exists mem_node_embedding_ivfflat_idx
  on mem.node using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- --------------------------------------------------------------------------
-- mem.alias
-- --------------------------------------------------------------------------
-- Alternative names that resolve to the same node. `household_id` is carried
-- on the alias row even though the node already has it: this avoids a join
-- in every RLS policy evaluation (the "is_member" helper runs per row).
-- A trigger backfills household_id from mem.node if the caller forgets.
--
-- `source` differentiates user-authored aliases ('manual') from
-- extractor-authored aliases ('extracted') or provider-imported ones
-- ('imported'). The reconciler uses `source` to decide whether a mismatch
-- is a human correction (trusted) or a model guess (needs reinforcement).
create table if not exists mem.alias (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.household(id) on delete cascade,
  node_id       uuid not null references mem.node(id) on delete cascade,
  alias         text not null,
  source        text not null check (source in ('manual','extracted','imported')),
  created_at    timestamptz not null default now(),
  unique (node_id, alias)
);

alter table mem.alias enable row level security;
alter table mem.alias force row level security;

-- Case-insensitive prefix lookup for alias matching during extraction.
create index if not exists mem_alias_lower_alias_idx
  on mem.alias (lower(alias) text_pattern_ops);

create index if not exists mem_alias_node_idx
  on mem.alias (node_id);

create index if not exists mem_alias_household_idx
  on mem.alias (household_id);

-- --------------------------------------------------------------------------
-- mem.edge
-- --------------------------------------------------------------------------
-- Directed typed relation between two mem.node rows. `evidence` accumulates
-- source-row pointers, and `weight` accumulates on duplicate assertions of
-- the same edge — see the "weight carries frequency" note in graph-schema.md.
--
-- (household_id, src_id, dst_id, type) is unique: the reconciler upserts on
-- this key rather than creating duplicate edges.
create table if not exists mem.edge (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.household(id) on delete cascade,
  src_id        uuid not null references mem.node(id) on delete cascade,
  dst_id        uuid not null references mem.node(id) on delete cascade,
  type          text not null check (type in (
    'attended','ate','contains','cooked','paid','purchased_at',
    'located_at','related_to','prefers','avoids','recurs','part_of'
  )),
  weight        real not null default 1.0,
  evidence      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, src_id, dst_id, type)
);

alter table mem.edge enable row level security;
alter table mem.edge force row level security;

create index if not exists mem_edge_household_src_type_idx
  on mem.edge (household_id, src_id, type);

create index if not exists mem_edge_household_dst_type_idx
  on mem.edge (household_id, dst_id, type);

-- --------------------------------------------------------------------------
-- mem.mention
-- --------------------------------------------------------------------------
-- Raw-row linkage. Keeps mem.edge thin (node-to-node) while letting us
-- answer "show me the receipt/email/meal that taught you this" by joining
-- through mention. No FK on (row_table, row_id) because row_table can
-- point at multiple tables (transaction, event, conversation_turn, ...).
create table if not exists mem.mention (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references app.household(id) on delete cascade,
  node_id        uuid not null references mem.node(id) on delete cascade,
  row_table      text not null,
  row_id         uuid not null,
  first_seen_at  timestamptz not null default now()
);

alter table mem.mention enable row level security;
alter table mem.mention force row level security;

create index if not exists mem_mention_row_idx
  on mem.mention (row_table, row_id);

create index if not exists mem_mention_household_node_idx
  on mem.mention (household_id, node_id);

-- --------------------------------------------------------------------------
-- mem.episode
-- --------------------------------------------------------------------------
-- A specific time-and-place event enriched from a source row (calendar
-- event, email, meal, transaction, or conversation). Embeddings support
-- the "similar past episodes" retrieval path.
create table if not exists mem.episode (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references app.household(id) on delete cascade,
  title          text not null,
  summary        text,
  occurred_at    timestamptz not null,
  ended_at       timestamptz,
  place_node_id  uuid references mem.node(id) on delete set null,
  participants   uuid[] not null default '{}'::uuid[],
  source_type    text not null check (source_type in (
    'event','email','meal','transaction','conversation'
  )),
  source_id      uuid not null,
  recorded_at    timestamptz not null default now(),
  metadata       jsonb not null default '{}'::jsonb,
  embedding      vector(1536)
);

alter table mem.episode enable row level security;
alter table mem.episode force row level security;

create index if not exists mem_episode_household_occurred_idx
  on mem.episode (household_id, occurred_at desc);

create index if not exists mem_episode_embedding_ivfflat_idx
  on mem.episode using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- --------------------------------------------------------------------------
-- Helper triggers
-- --------------------------------------------------------------------------

-- Shared updated_at trigger. Both mem.node and mem.edge maintain
-- `updated_at`; the reconciler relies on it to stream only rows modified
-- since the last run. Keep as plpgsql (not sql) so the function body is
-- reference-resolved at execute time rather than creation time.
create or replace function mem.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists mem_node_touch_updated_at on mem.node;
create trigger mem_node_touch_updated_at
  before update on mem.node
  for each row
  execute function mem.touch_updated_at();

drop trigger if exists mem_edge_touch_updated_at on mem.edge;
create trigger mem_edge_touch_updated_at
  before update on mem.edge
  for each row
  execute function mem.touch_updated_at();

-- mem.alias.household_id safety-net: if an M3-B worker inserts an alias
-- without setting household_id, backfill from the referenced node. Keeps
-- RLS policies simple (they only need to look at the alias row, never
-- the node) while not requiring every caller to remember the column.
create or replace function mem.alias_fill_household_id()
returns trigger
language plpgsql
as $$
begin
  if new.household_id is null then
    select n.household_id into new.household_id
    from mem.node n
    where n.id = new.node_id;
  end if;
  return new;
end
$$;

drop trigger if exists mem_alias_fill_household_id on mem.alias;
create trigger mem_alias_fill_household_id
  before insert on mem.alias
  for each row
  execute function mem.alias_fill_household_id();

-- --------------------------------------------------------------------------
-- RLS policies
--
-- Pattern: readable by any household member, writable by service role
-- only, with narrow carve-outs for mem.node (update curated columns) and
-- mem.alias (insert manual aliases).
-- --------------------------------------------------------------------------

-- --- mem.node -------------------------------------------------------------
drop policy if exists mem_node_read on mem.node;
create policy mem_node_read on mem.node
  for select
  using (app.is_member(household_id));

-- Members can only UPDATE the human-curated columns (`manual_notes_md`,
-- `needs_review`). All other column writes must go through service_role.
-- We enforce this at the policy layer by refusing updates that change
-- any other column. Postgres evaluates the USING clause against the old
-- row and the WITH CHECK clause against the new row; a CHECK clause that
-- compares OLD and NEW lives in a trigger. We therefore use a trigger
-- guard to restrict the update to those two columns, and the policy
-- gates UPDATE broadly to household members.
drop policy if exists mem_node_update_curated on mem.node;
create policy mem_node_update_curated on mem.node
  for update
  using (app.is_member(household_id))
  with check (app.is_member(household_id));

-- Trigger guard: non-service-role UPDATEs on mem.node may only touch
-- `manual_notes_md` and `needs_review`. service_role bypasses RLS anyway
-- but we still let it mutate any column (it runs as the workers).
create or replace function mem.node_member_update_guard()
returns trigger
language plpgsql
as $$
begin
  -- service_role bypasses RLS and is the canonical worker identity.
  -- current_user / current_role is 'postgres' or 'service_role' for
  -- workers; end-user JWTs land as 'authenticated'. Guard only hits
  -- when the caller is 'authenticated'.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.id <> old.id
     or new.household_id <> old.household_id
     or new.type <> old.type
     or new.canonical_name <> old.canonical_name
     or new.document_md is distinct from old.document_md
     or new.metadata::text <> old.metadata::text
     or new.embedding::text is distinct from old.embedding::text
     or new.created_at <> old.created_at
  then
    raise exception 'mem.node: members may only update manual_notes_md and needs_review'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists mem_node_member_update_guard on mem.node;
create trigger mem_node_member_update_guard
  before update on mem.node
  for each row
  execute function mem.node_member_update_guard();

-- --- mem.alias ------------------------------------------------------------
drop policy if exists mem_alias_read on mem.alias;
create policy mem_alias_read on mem.alias
  for select
  using (app.is_member(household_id));

-- Members may INSERT aliases tagged `source = 'manual'`. Extractor /
-- importer aliases are service-role only.
drop policy if exists mem_alias_insert_manual on mem.alias;
create policy mem_alias_insert_manual on mem.alias
  for insert
  with check (
    app.is_member(household_id)
    and source = 'manual'
  );

-- No UPDATE / DELETE policies for authenticated — service role only.

-- --- mem.edge -------------------------------------------------------------
drop policy if exists mem_edge_read on mem.edge;
create policy mem_edge_read on mem.edge
  for select
  using (app.is_member(household_id));
-- No authenticated write policies. Edges are worker-authored.

-- --- mem.mention ----------------------------------------------------------
drop policy if exists mem_mention_read on mem.mention;
create policy mem_mention_read on mem.mention
  for select
  using (app.is_member(household_id));
-- No authenticated write policies. Mentions are worker-authored.

-- --- mem.episode ----------------------------------------------------------
drop policy if exists mem_episode_read on mem.episode;
create policy mem_episode_read on mem.episode
  for select
  using (app.is_member(household_id));
-- No authenticated write policies. Episodes are worker-authored.
