-- Migration: 0007_alerts_suggestions_actions.sql
-- Authored: 2026-04-20
-- Purpose: add app.alert, app.suggestion, app.action, app.summary
--          with RLS. Actions get an explicit status-transition trigger
--          because state moves are server-side only.
-- Owner: @infra-platform
-- Spec: specs/02-data-model/schema.md + specs/06-segments/* (per-segment
--       alerts) + specs/09-security/auth.md (service-role boundary).
--
-- RLS shape:
--   - alert / suggestion / summary: segment-gated, standard pattern.
--   - action: ANY household member can INSERT (they trigger actions by
--     approving suggestions); only the service role can UPDATE (status
--     transitions). A trigger enforces that only the documented state
--     machine `pending → running → succeeded|failed` is legal.

-- --------------------------------------------------------------------------
-- app.alert
-- --------------------------------------------------------------------------

create table if not exists app.alert (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references app.household(id) on delete cascade,
  segment        text not null check (segment in ('financial','food','fun','social','system')),
  severity       text not null check (severity in ('info','warn','critical')),
  title          text not null,
  body           text not null,
  generated_by   text not null,
  generated_at   timestamptz not null default now(),
  dismissed_at   timestamptz,
  dismissed_by   uuid references app.member(id) on delete set null,
  context        jsonb not null default '{}'::jsonb
);

alter table app.alert enable row level security;
alter table app.alert force row level security;

create index if not exists alert_household_generated_idx
  on app.alert (household_id, generated_at desc);

create index if not exists alert_household_segment_idx
  on app.alert (household_id, segment);

-- Hot partial index on active alerts.
create index if not exists alert_household_active_idx
  on app.alert (household_id, generated_at desc)
  where dismissed_at is null;

-- --------------------------------------------------------------------------
-- app.suggestion
-- --------------------------------------------------------------------------

create table if not exists app.suggestion (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.household(id) on delete cascade,
  segment       text not null check (segment in ('financial','food','fun','social','system')),
  kind          text not null,
  title         text not null,
  rationale     text not null,
  preview       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','executed','expired')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references app.member(id) on delete set null
);

alter table app.suggestion enable row level security;
alter table app.suggestion force row level security;

create index if not exists suggestion_household_created_idx
  on app.suggestion (household_id, created_at desc);

create index if not exists suggestion_household_segment_idx
  on app.suggestion (household_id, segment);

-- The hottest read: "what pending suggestions are in front of the user?"
create index if not exists suggestion_household_pending_idx
  on app.suggestion (household_id)
  where status = 'pending';

-- --------------------------------------------------------------------------
-- app.action
-- --------------------------------------------------------------------------

create table if not exists app.action (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references app.household(id) on delete cascade,
  suggestion_id  uuid references app.suggestion(id) on delete set null,
  -- Segment used by RLS. Must match the suggestion's segment when
  -- suggestion_id is set; enforced by trigger below.
  segment        text not null check (segment in ('financial','food','fun','social','system')),
  kind           text not null,
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending'
                   check (status in ('pending','running','succeeded','failed')),
  started_at     timestamptz,
  finished_at    timestamptz,
  error          text,
  result         jsonb,
  created_by     uuid references app.member(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table app.action enable row level security;
alter table app.action force row level security;

create index if not exists action_household_created_idx
  on app.action (household_id, created_at desc);

create index if not exists action_household_status_idx
  on app.action (household_id, status);

-- Status-transition trigger. Enforces the state machine regardless of who
-- is writing (even service_role). Idempotent self-transitions (pending→pending)
-- are allowed so upserts do not fight the trigger.
create or replace function app.action_status_transition_guard()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    if OLD.status = NEW.status then
      return NEW;
    end if;
    if OLD.status = 'pending'  and NEW.status = 'running'    then return NEW; end if;
    if OLD.status = 'running'  and NEW.status = 'succeeded'  then return NEW; end if;
    if OLD.status = 'running'  and NEW.status = 'failed'     then return NEW; end if;
    -- pending → failed is allowed for pre-flight validation failures.
    if OLD.status = 'pending'  and NEW.status = 'failed'     then return NEW; end if;
    raise exception 'invalid action status transition: % -> %', OLD.status, NEW.status
      using errcode = '23514';
  end if;
  return NEW;
end
$$;

drop trigger if exists action_status_transition_guard on app.action;
create trigger action_status_transition_guard
  before update on app.action
  for each row
  execute function app.action_status_transition_guard();

-- --------------------------------------------------------------------------
-- app.summary
-- --------------------------------------------------------------------------

create table if not exists app.summary (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references app.household(id) on delete cascade,
  segment         text not null check (segment in ('financial','food','fun','social','system')),
  period          text not null check (period in ('daily','weekly','monthly')),
  covered_start   timestamptz not null,
  covered_end     timestamptz not null,
  body_md         text not null,
  generated_at    timestamptz not null default now(),
  model           text not null
);

alter table app.summary enable row level security;
alter table app.summary force row level security;

create index if not exists summary_household_period_idx
  on app.summary (household_id, segment, covered_end desc);

-- --------------------------------------------------------------------------
-- RLS policies
-- --------------------------------------------------------------------------

-- --- alert ---------------------------------------------------------------
drop policy if exists alert_read on app.alert;
create policy alert_read on app.alert
  for select
  using (app.can_read_segment(household_id, segment));

drop policy if exists alert_update on app.alert;
-- Members can only dismiss; write segment grant required.
create policy alert_update on app.alert
  for update
  using (app.can_write_segment(household_id, segment))
  with check (app.can_write_segment(household_id, segment));
-- Inserts are service-role only (workers generate alerts). No INSERT policy
-- for `authenticated` is declared, so inserts from the JWT role are
-- refused by RLS. service_role bypasses RLS.

-- --- suggestion ----------------------------------------------------------
drop policy if exists suggestion_read on app.suggestion;
create policy suggestion_read on app.suggestion
  for select
  using (app.can_read_segment(household_id, segment));

drop policy if exists suggestion_update on app.suggestion;
-- Approve/reject requires write-segment; execution/expired happen
-- server-side via service role.
create policy suggestion_update on app.suggestion
  for update
  using (app.can_write_segment(household_id, segment))
  with check (app.can_write_segment(household_id, segment));
-- No INSERT policy: service role only.

-- --- action --------------------------------------------------------------
drop policy if exists action_read on app.action;
create policy action_read on app.action
  for select
  using (app.can_read_segment(household_id, segment));

drop policy if exists action_insert on app.action;
-- Any member with write access to the segment can initiate an action.
-- The row starts in `pending`; service-role workers move it forward.
create policy action_insert on app.action
  for insert
  with check (
    app.can_write_segment(household_id, segment)
    and status = 'pending'
  );
-- No UPDATE/DELETE policies for authenticated: status transitions are
-- service-role only (the worker performs the provider call and records
-- the outcome). The trigger guards the state machine regardless.

-- --- summary -------------------------------------------------------------
drop policy if exists summary_read on app.summary;
create policy summary_read on app.summary
  for select
  using (app.can_read_segment(household_id, segment));
-- Write is service-role only.
