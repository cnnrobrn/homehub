-- Migration: 0012_email_ingestion.sql
-- Authored: 2026-04-20
-- Purpose: add app.email + app.email_attachment tables (Gmail ingestion
--          destination) and the sync.provider_connection.metadata column
--          that carries per-member email-category opt-ins.
-- Owner: @infra-platform
-- Spec: specs/03-integrations/google-workspace.md.
--
-- M4-A shipped the sync-gmail worker feature-flagged off until this
-- migration lands (see apps/workers/sync-gmail/README.md + handler.ts).
-- Once 0012 + 0013 apply and `db:types` regenerates, the flag can flip
-- via Railway env to start real ingestion.
--
-- RLS shape:
--   - app.email: segment-gated read via app.can_read_segment. On sync
--     every row is stamped segment='system'; M4-B extraction can
--     reclassify ('financial' for receipts/bills, 'food' for food
--     orders, 'fun' for reservations, 'social' for invites). Writes are
--     service-role only (the sync worker runs as service role).
--   - app.email_attachment: read gated by the join to the parent
--     app.email row (same segment check); writes service-role only.
--
-- Storage bucket + storage.objects policy live in 0013 so this file
-- stays within the app/sync schema boundary.

-- --------------------------------------------------------------------------
-- sync.provider_connection.metadata
--
-- M4-C writes `metadata.email_categories` (the member's opt-in set) as
-- part of the privacy-preview flow; sync-gmail reads it to intersect
-- server-side Gmail filters. Using `if not exists` keeps the migration
-- idempotent on re-apply.
-- --------------------------------------------------------------------------

alter table sync.provider_connection
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- --------------------------------------------------------------------------
-- app.email
--
-- One row per ingested Gmail message. `source_id` is the Gmail message
-- id; uniqueness is `(household_id, provider, source_id)` so the same
-- message landing from two members' connections collapses to one row
-- under the household. `body_preview` is capped at 2KB per
-- specs/09-security/data-retention.md; this is enforced by the worker,
-- not the column (we keep the column `text` so a future longer preview
-- knob doesn't require a migration).
--
-- `segment` starts as 'system' on sync. M4-B extraction reclassifies.
-- `categories` is a free array of {'receipt','reservation','bill',
-- 'invite','shipping',...} heuristic tags applied at sync time.
-- --------------------------------------------------------------------------

create table if not exists app.email (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references app.household(id) on delete cascade,
  member_id        uuid references app.member(id) on delete set null,
  connection_id    uuid references sync.provider_connection(id) on delete set null,
  provider         text not null default 'gmail',
  source_id        text not null,
  source_version   text,
  thread_id        text,
  subject          text,
  from_email       text,
  from_name        text,
  to_emails        text[] not null default '{}',
  received_at      timestamptz not null,
  categories       text[] not null default '{}',
  body_preview     text,
  has_attachments  boolean not null default false,
  labels           text[] not null default '{}',
  metadata         jsonb not null default '{}'::jsonb,
  segment          text not null default 'system'
                     check (segment in ('financial','food','fun','social','system')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table app.email enable row level security;
alter table app.email force row level security;

-- Dedup: same (household, provider, message-id) is one row. Using a
-- table-level unique constraint instead of a partial unique index
-- because `provider` defaults to 'gmail' and `source_id` is NOT NULL,
-- so every row participates — no partial-index gymnastics needed.
create unique index if not exists app_email_dedupe
  on app.email (household_id, provider, source_id);

-- Hot path: the inbox-like UIs and the enrichment feeder list by
-- household + received_at desc.
create index if not exists app_email_household_received
  on app.email (household_id, received_at desc);

-- The hottest category cut for M4-B is receipts → transactions; the
-- partial index keeps "is this a receipt?" checks index-only without
-- indexing the full array. When the category taxonomy grows we can
-- swap for a GIN in a later migration.
create index if not exists app_email_household_receipt
  on app.email (household_id)
  where 'receipt' = any (categories);

-- Thread grouping for UI and for the M4-B extractor.
create index if not exists app_email_thread
  on app.email (household_id, thread_id)
  where thread_id is not null;

-- --------------------------------------------------------------------------
-- app.email_attachment
--
-- One row per attachment persisted to Supabase Storage. `storage_path`
-- is the object key inside the `email_attachments` bucket (bucket
-- provisioned in 0013). Shape:
--   <household_id>/email/<email_id>/<attachment_uuid>
-- matches what the sync worker writes (see
-- apps/workers/sync-gmail/src/handler.ts::persistAttachments).
--
-- `content_hash` enables the hash-based de-dup flagged in the
-- google-workspace spec open question ("same receipt PDF across two
-- members"); worker-side de-dup can land later without schema change.
-- --------------------------------------------------------------------------

create table if not exists app.email_attachment (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references app.household(id) on delete cascade,
  email_id       uuid not null references app.email(id) on delete cascade,
  filename       text not null,
  content_type   text,
  size_bytes     bigint,
  storage_path   text not null,
  content_hash   text,
  created_at     timestamptz not null default now(),
  unique (storage_path)
);

alter table app.email_attachment enable row level security;
alter table app.email_attachment force row level security;

create index if not exists app_email_attachment_email
  on app.email_attachment (email_id);

create index if not exists app_email_attachment_household_hash
  on app.email_attachment (household_id, content_hash)
  where content_hash is not null;

-- --------------------------------------------------------------------------
-- RLS policies
-- --------------------------------------------------------------------------

-- --- app.email -----------------------------------------------------------
drop policy if exists email_read on app.email;
create policy email_read on app.email
  for select
  using (app.can_read_segment(household_id, segment));
-- No INSERT/UPDATE/DELETE policy for authenticated: the sync worker
-- writes as service_role (which bypasses RLS). `force row level
-- security` blocks any accidental member writes — matches the pattern
-- used for app.alert / app.suggestion / app.summary in 0007.

-- --- app.email_attachment ------------------------------------------------
drop policy if exists email_attachment_read on app.email_attachment;
-- Read gate joins through the parent email row so the same segment
-- check applies. Denormalized `household_id` on the attachment keeps
-- the plan cheap but the segment is the authoritative gate.
create policy email_attachment_read on app.email_attachment
  for select
  using (
    exists (
      select 1 from app.email e
      where e.id = app.email_attachment.email_id
        and app.can_read_segment(e.household_id, e.segment)
    )
  );
-- Writes are service-role only (sync worker). No authenticated policy.
