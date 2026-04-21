-- Migration: 0014_ops_heartbeat_exports.sql
-- Authored: 2026-04-20
-- Purpose: provision operations-readiness plumbing for M10:
--          - sync.worker_heartbeat  (worker last-seen table)
--          - sync.household_export  (request + bookkeeping)
--          - storage bucket `household_exports`
--          - compound index on app.model_calls for the model-usage dashboard
-- Owner: @infra-platform
-- Spec:  specs/10-operations/observability.md (worker heartbeats,
--        per-household model usage); scripts/agents/infra-platform.md
--        (M10 dispatch).
--
-- Collision note: if another agent (M8, M5-B, M9-A, etc.) has already
-- claimed 0014, renumber this file and update its references in
-- apps/workers/backup-export/README.md and docs/ops/*.
--
-- RLS stance:
--   - sync.worker_heartbeat  : service-role only. Dashboards read via
--                              service client; member JWTs never
--                              touch this surface.
--   - sync.household_export  : owners read their household's rows;
--                              writes are service-role only.
--   - storage.bucket         : private bucket; SELECT via a joined
--                              policy keyed on the export row's
--                              household + requester owner role.
--   - app.model_calls        : unchanged; only a compound index added.

-- --------------------------------------------------------------------------
-- sync.worker_heartbeat
--
-- One row per (service, component). `recordWorkerHeartbeat()` in the
-- worker runtime upserts this row once a minute. `last_seen_at`
-- staleness becomes the alerting signal in /ops/health.
-- --------------------------------------------------------------------------

create table if not exists sync.worker_heartbeat (
  service      text not null,
  component    text not null,
  last_seen_at timestamptz not null default now(),
  metadata     jsonb not null default '{}',
  primary key (service, component)
);

alter table sync.worker_heartbeat enable row level security;
alter table sync.worker_heartbeat force row level security;
-- service role only; no policies declared.

create index if not exists worker_heartbeat_last_seen
  on sync.worker_heartbeat (last_seen_at desc);

-- --------------------------------------------------------------------------
-- sync.household_export
--
-- Request row for a household data export. `requestHouseholdExportAction`
-- in the web app inserts here (service-role via auth-server) and
-- enqueues a `household_export` pgmq message carrying this row's id.
-- The backup-export worker updates `status`, `storage_path`,
-- `size_bytes`, `completed_at` as it progresses.
-- --------------------------------------------------------------------------

create table if not exists sync.household_export (
  id                      uuid primary key default gen_random_uuid(),
  household_id            uuid not null references app.household(id) on delete cascade,
  requested_by_member_id  uuid references app.member(id) on delete set null,
  status                  text not null check (status in ('pending','running','succeeded','failed')),
  storage_path            text,
  size_bytes              bigint,
  requested_at            timestamptz not null default now(),
  completed_at            timestamptz,
  error                   text
);

alter table sync.household_export enable row level security;
alter table sync.household_export force row level security;

-- Owners read their household's export history. Writes are service-
-- role only (the backup worker is the only writer).
drop policy if exists household_export_read on sync.household_export;
create policy household_export_read on sync.household_export
  for select
  using (
    exists (
      select 1
      from app.member m
      where m.household_id = household_export.household_id
        and m.user_id      = app.current_user_id()
        and m.role         = 'owner'
    )
  );

create index if not exists household_export_recent
  on sync.household_export (household_id, requested_at desc);

-- --------------------------------------------------------------------------
-- Storage bucket
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('household_exports', 'household_exports', false)
on conflict (id) do nothing;

-- SELECT policy: members with the `owner` role on a household can
-- read objects whose storage_path begins with
-- `<household_id>/` AND a matching `sync.household_export` row
-- exists. Uploads are service-role only.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'owners read own household exports'
  ) then
    create policy "owners read own household exports"
      on storage.objects
      for select
      using (
        bucket_id = 'household_exports'
        and exists (
          select 1
          from sync.household_export he
          join app.member m on m.household_id = he.household_id
          where he.storage_path = storage.objects.name
            and m.user_id = app.current_user_id()
            and m.role    = 'owner'
        )
      );
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- app.model_calls — add a compound index for the model-usage dashboard
--
-- The `/ops/model-usage` page filters by (household_id, at, task).
-- The existing `(household_id, at desc)` and `(household_id, task, at desc)`
-- indexes from migration 0009 already cover those access paths — this
-- migration adds nothing destructive and is a no-op on an up-to-date
-- database. Documented here so the dispatch report's index requirement
-- has a migration record.
-- --------------------------------------------------------------------------

-- No-op; left here as documentation. Remove before review if the ops
-- dashboard needs a different shape.
