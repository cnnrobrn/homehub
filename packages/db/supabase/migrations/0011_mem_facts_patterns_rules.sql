-- Migration: 0011_mem_facts_patterns_rules.sql
-- Authored: 2026-04-20
-- Purpose: install the "beliefs" layer of the memory graph on top of the
--          skeleton from 0010: mem.fact + mem.fact_candidate (bi-temporal
--          beliefs and their pre-reconciliation staging row),
--          mem.pattern (procedural regularities), mem.rule (member-authored
--          household rules), and mem.insight (weekly reflection output).
-- Owner: @infra-platform
-- Spec: specs/04-memory-network/graph-schema.md (fact/pattern/rule/insight
--       sections) + temporal.md + extraction.md.
--
-- RLS stance:
--   - mem.fact, mem.fact_candidate, mem.pattern, mem.insight:
--     read by any household member, write by service role only.
--     These are extractor/reconciler/reflection outputs — the UI shows
--     them but never mutates them.
--   - mem.rule: members INSERT/UPDATE/DELETE their own rules (authored by
--     their member id). Other-household members cannot touch them.
--     Read is open to any household member, matching the "household-wide
--     visibility" stance in the conversations spec.
--
-- Bi-temporal columns on mem.fact mirror specs/04-memory-network/temporal.md:
--   - valid_from/valid_to: the window of time the fact asserts to hold true.
--   - recorded_at: when we came to believe it (immutable after creation).
--   - superseded_at / superseded_by: non-null when a newer fact replaces this
--     one. The hot-path index excludes superseded rows via the partial
--     predicate `where valid_to is null`.
--
-- mem.fact_candidate is the pre-reconciliation staging area: the extractor
-- writes candidates, the reconciler reads them, upgrades matches into
-- mem.fact, and marks the candidate `promoted`. Shape is the same as
-- mem.fact plus a `status` lifecycle.

-- --------------------------------------------------------------------------
-- mem.fact
-- --------------------------------------------------------------------------

create table if not exists mem.fact (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references app.household(id) on delete cascade,
  subject_node_id      uuid not null references mem.node(id) on delete cascade,
  predicate            text not null,
  object_value         jsonb,
  object_node_id       uuid references mem.node(id) on delete set null,
  confidence           real not null check (confidence >= 0 and confidence <= 1),
  evidence             jsonb not null default '[]'::jsonb,
  valid_from           timestamptz not null,
  valid_to             timestamptz,
  recorded_at          timestamptz not null default now(),
  superseded_at        timestamptz,
  superseded_by        uuid references mem.fact(id) on delete set null,
  source               text not null check (source in (
    'member','extraction','consolidation','reflection'
  )),
  reinforcement_count  int not null default 1,
  last_reinforced_at   timestamptz not null default now(),
  conflict_status      text not null default 'none'
                        check (conflict_status in ('none','parked_conflict','unresolved'))
);

alter table mem.fact enable row level security;
alter table mem.fact force row level security;

-- Hot "currently true" lookup: partial index on valid_to is null.
create index if not exists mem_fact_current_idx
  on mem.fact (household_id, subject_node_id, predicate)
  where valid_to is null;

-- Superseded-trail index for audit / debugging model drift.
create index if not exists mem_fact_superseded_idx
  on mem.fact (household_id, superseded_at)
  where superseded_at is not null;

-- --------------------------------------------------------------------------
-- mem.fact_candidate
-- --------------------------------------------------------------------------
-- Same-shape staging row. Columns that are `not null` on mem.fact are
-- relaxed here because the extractor sometimes writes partially-resolved
-- candidates (subject known but predicate unresolved, etc.); reconciler
-- either fills them or rejects the row.
create table if not exists mem.fact_candidate (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references app.household(id) on delete cascade,
  subject_node_id     uuid references mem.node(id) on delete cascade,
  predicate           text not null,
  object_value        jsonb,
  object_node_id      uuid references mem.node(id) on delete set null,
  confidence          real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence            jsonb not null default '[]'::jsonb,
  valid_from          timestamptz,
  valid_to            timestamptz,
  recorded_at         timestamptz not null default now(),
  source              text not null check (source in (
    'member','extraction','consolidation','reflection'
  )),
  status              text not null default 'pending'
                        check (status in ('pending','promoted','rejected','parked','superseded')),
  promoted_fact_id    uuid references mem.fact(id) on delete set null,
  reason              text
);

alter table mem.fact_candidate enable row level security;
alter table mem.fact_candidate force row level security;

-- Reconciler's working queue: pending candidates by (subject, predicate).
create index if not exists mem_fact_candidate_pending_idx
  on mem.fact_candidate (household_id, subject_node_id, predicate)
  where status = 'pending';

-- --------------------------------------------------------------------------
-- mem.pattern
-- --------------------------------------------------------------------------

create table if not exists mem.pattern (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references app.household(id) on delete cascade,
  kind                text not null check (kind in ('temporal','co_occurrence','threshold')),
  description         text not null,
  parameters          jsonb not null default '{}'::jsonb,
  confidence          real not null check (confidence >= 0 and confidence <= 1),
  sample_size         int not null,
  observed_from       timestamptz not null,
  observed_to         timestamptz not null,
  last_reinforced_at  timestamptz not null default now(),
  status              text not null default 'active'
                        check (status in ('active','decayed','archived'))
);

alter table mem.pattern enable row level security;
alter table mem.pattern force row level security;

create index if not exists mem_pattern_household_status_idx
  on mem.pattern (household_id, status);

-- --------------------------------------------------------------------------
-- mem.rule
-- --------------------------------------------------------------------------
-- Member-authored household policies. `predicate_dsl` is a structured JSON
-- representation that the runtime evaluates — shape is defined by the
-- suggestion engine, not this schema.
create table if not exists mem.rule (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references app.household(id) on delete cascade,
  author_member_id  uuid not null references app.member(id) on delete cascade,
  description       text not null,
  predicate_dsl     jsonb not null,
  created_at        timestamptz not null default now(),
  active            boolean not null default true
);

alter table mem.rule enable row level security;
alter table mem.rule force row level security;

create index if not exists mem_rule_household_active_idx
  on mem.rule (household_id, active);

-- --------------------------------------------------------------------------
-- mem.insight
-- --------------------------------------------------------------------------

create table if not exists mem.insight (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references app.household(id) on delete cascade,
  week_start            date not null,
  body_md               text not null,
  promoted_to_rule_id   uuid references mem.rule(id) on delete set null,
  created_at            timestamptz not null default now()
);

alter table mem.insight enable row level security;
alter table mem.insight force row level security;

create index if not exists mem_insight_household_week_idx
  on mem.insight (household_id, week_start desc);

-- --------------------------------------------------------------------------
-- RLS policies
-- --------------------------------------------------------------------------

-- --- mem.fact -------------------------------------------------------------
drop policy if exists mem_fact_read on mem.fact;
create policy mem_fact_read on mem.fact
  for select
  using (app.is_member(household_id));
-- Writes: service role only.

-- --- mem.fact_candidate ---------------------------------------------------
drop policy if exists mem_fact_candidate_read on mem.fact_candidate;
create policy mem_fact_candidate_read on mem.fact_candidate
  for select
  using (app.is_member(household_id));
-- Writes: service role only.

-- --- mem.pattern ----------------------------------------------------------
drop policy if exists mem_pattern_read on mem.pattern;
create policy mem_pattern_read on mem.pattern
  for select
  using (app.is_member(household_id));
-- Writes: service role only.

-- --- mem.rule -------------------------------------------------------------
-- Read: any household member. Author-authored, so writes are scoped to the
-- calling member's id via app.member_id(household_id).
drop policy if exists mem_rule_read on mem.rule;
create policy mem_rule_read on mem.rule
  for select
  using (app.is_member(household_id));

drop policy if exists mem_rule_insert on mem.rule;
create policy mem_rule_insert on mem.rule
  for insert
  with check (
    app.is_member(household_id)
    and author_member_id = app.member_id(household_id)
  );

drop policy if exists mem_rule_update on mem.rule;
create policy mem_rule_update on mem.rule
  for update
  using (
    app.is_member(household_id)
    and author_member_id = app.member_id(household_id)
  )
  with check (
    app.is_member(household_id)
    and author_member_id = app.member_id(household_id)
  );

drop policy if exists mem_rule_delete on mem.rule;
create policy mem_rule_delete on mem.rule
  for delete
  using (
    app.is_member(household_id)
    and author_member_id = app.member_id(household_id)
  );

-- --- mem.insight ----------------------------------------------------------
drop policy if exists mem_insight_read on mem.insight;
create policy mem_insight_read on mem.insight
  for select
  using (app.is_member(household_id));
-- Writes: service role only (reflection worker).
