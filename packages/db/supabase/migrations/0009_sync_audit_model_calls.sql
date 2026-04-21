-- Migration: 0009_sync_audit_model_calls.sql
-- Authored: 2026-04-20
-- Purpose: create sync.provider_connection / sync.cursor / sync.dead_letter,
--          audit.event, and app.model_calls. These light up the M0-C stubs
--          in packages/worker-runtime (queueClient.deadLetter, model-call
--          recorder, withBudgetGuard).
-- Owner: @infra-platform
-- Spec: specs/02-data-model/schema.md (Sync + Audit sections) + worker
--       runtime README.md (stub pointers).
--
-- RLS stance:
--   - sync.*:            service-role only for writes; `provider_connection`
--                        is readable by household members so the UI can show
--                        "X is connected". `dead_letter` is service-role
--                        only for both read and write.
--   - audit.event:       service-role only for both read and write in M1.
--                        Open question in the spec suggests a SECURITY
--                        INVOKER view for owners later; deferred.
--   - app.model_calls:   service-role only for writes; read by household
--                        owners only (budget page uses it).

-- --------------------------------------------------------------------------
-- sync.provider_connection
-- --------------------------------------------------------------------------

create table if not exists sync.provider_connection (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references app.household(id) on delete cascade,
  member_id            uuid references app.member(id) on delete set null,
  provider             text not null,
  nango_connection_id  text not null,
  status               text not null default 'active'
                         check (status in ('active','paused','errored','revoked')),
  last_synced_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (household_id, provider, nango_connection_id)
);

alter table sync.provider_connection enable row level security;
alter table sync.provider_connection force row level security;

create index if not exists provider_connection_household_idx
  on sync.provider_connection (household_id);

create index if not exists provider_connection_provider_idx
  on sync.provider_connection (provider, status);

-- --------------------------------------------------------------------------
-- sync.cursor
-- --------------------------------------------------------------------------

create table if not exists sync.cursor (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references sync.provider_connection(id) on delete cascade,
  kind           text not null,
  value          text,
  updated_at     timestamptz not null default now(),
  unique (connection_id, kind)
);

alter table sync.cursor enable row level security;
alter table sync.cursor force row level security;

create index if not exists cursor_connection_idx
  on sync.cursor (connection_id);

-- --------------------------------------------------------------------------
-- sync.dead_letter
--
-- queueClient.deadLetter() in packages/worker-runtime inserts here. The
-- payload is the full MessageEnvelope so we can replay after a fix.
-- --------------------------------------------------------------------------

create table if not exists sync.dead_letter (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid references sync.provider_connection(id) on delete set null,
  queue          text not null,
  message_id     bigint,
  payload        jsonb not null,
  error          text not null,
  received_at    timestamptz not null default now()
);

alter table sync.dead_letter enable row level security;
alter table sync.dead_letter force row level security;

create index if not exists dead_letter_queue_received_idx
  on sync.dead_letter (queue, received_at desc);

create index if not exists dead_letter_connection_idx
  on sync.dead_letter (connection_id)
  where connection_id is not null;

-- --------------------------------------------------------------------------
-- audit.event
--
-- Append-only. Service-role writes every mutation the workers and server
-- actions perform. No RLS policies for authenticated are declared, so
-- the JWT role cannot read or write. service_role bypasses RLS.
-- --------------------------------------------------------------------------

create table if not exists audit.event (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid references app.household(id) on delete set null,
  actor_user_id   uuid references auth.users(id) on delete set null,
  action          text not null,
  resource_type   text not null,
  resource_id     uuid,
  before          jsonb,
  after           jsonb,
  at              timestamptz not null default now()
);

alter table audit.event enable row level security;
alter table audit.event force row level security;

create index if not exists audit_event_household_at_idx
  on audit.event (household_id, at desc);

create index if not exists audit_event_resource_idx
  on audit.event (resource_type, resource_id, at desc);

-- --------------------------------------------------------------------------
-- app.model_calls
--
-- One row per `generate()` call. Workers insert via service role; the
-- budget guard reads current-month cost per household to enforce caps.
-- Read access limited to owners since it exposes per-household model
-- spend.
-- --------------------------------------------------------------------------

create table if not exists app.model_calls (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references app.household(id) on delete cascade,
  task           text not null,
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric(12,6) not null default 0,
  latency_ms     integer,
  at             timestamptz not null default now()
);

alter table app.model_calls enable row level security;
alter table app.model_calls force row level security;

create index if not exists model_calls_household_at_idx
  on app.model_calls (household_id, at desc);

create index if not exists model_calls_household_task_idx
  on app.model_calls (household_id, task, at desc);

-- --------------------------------------------------------------------------
-- RLS policies
-- --------------------------------------------------------------------------

-- --- sync.provider_connection -------------------------------------------
drop policy if exists provider_connection_read on sync.provider_connection;
create policy provider_connection_read on sync.provider_connection
  for select
  using (app.is_member(household_id));
-- Writes are service-role only: workers create/update connections through
-- the Nango webhook path. No authenticated write policy declared.

-- --- sync.cursor ---------------------------------------------------------
-- No policies for authenticated — cursors are operational data that a UI
-- would never touch. service_role bypasses RLS.

-- --- sync.dead_letter ----------------------------------------------------
-- No policies for authenticated. Operators read via the DLQ tooling (M10)
-- which runs with service role.

-- --- audit.event ---------------------------------------------------------
-- No policies for authenticated. service_role only. A future
-- `audit.event_for_owner` SECURITY INVOKER view can expose a filtered
-- slice to household owners; deferred until there is a UI need.

-- --- app.model_calls -----------------------------------------------------
drop policy if exists model_calls_read on app.model_calls;
-- Owners only: shows per-household model spend.
create policy model_calls_read on app.model_calls
  for select
  using (
    exists (
      select 1 from app.member m
      where m.household_id = app.model_calls.household_id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  );
-- Writes are service-role only.
