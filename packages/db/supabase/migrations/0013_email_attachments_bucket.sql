-- Migration: 0013_email_attachments_bucket.sql
-- Authored: 2026-04-20
-- Purpose: provision the `email_attachments` Supabase Storage bucket plus
--          a household-scoped RLS policy on storage.objects so members
--          can download attachments for emails they're allowed to read.
-- Owner: @infra-platform
-- Spec: specs/03-integrations/google-workspace.md (Gmail attachments
--       stored in Supabase Storage with household-scoped RLS).
--
-- Bucket layout (written by apps/workers/sync-gmail/src/handler.ts):
--   email_attachments/<household_id>/email/<email_id>/<attachment_uuid>
--
-- RLS stance:
--   - Upload is service-role only (sync worker). No INSERT/UPDATE/DELETE
--     policies for authenticated are declared, and service_role bypasses
--     RLS so the worker can write freely.
--   - SELECT joins through app.email_attachment → app.email so the same
--     segment gate that controls email visibility controls attachment
--     download. An attachment object whose storage_path has no backing
--     row (mid-ingestion / stale cleanup) is invisible to members.

-- --------------------------------------------------------------------------
-- Bucket
--
-- Private bucket (public = false). Idempotent insert so re-applying the
-- migration against an environment that already has the bucket is a
-- no-op.
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('email_attachments', 'email_attachments', false)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- RLS policy on storage.objects
--
-- storage.objects has RLS enabled by Supabase by default. We add a
-- SELECT policy scoped to this bucket only; other buckets remain
-- governed by whatever policies they carry.
--
-- Wrapped in a `do $$ ... if not exists ...` block because
-- `create policy` has no `if not exists` clause and storage policies
-- can't use the `drop policy if exists` preamble cleanly without
-- risking a drop race in shared environments.
-- --------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'members read own household email attachments'
  ) then
    create policy "members read own household email attachments"
      on storage.objects
      for select
      using (
        bucket_id = 'email_attachments'
        and exists (
          select 1
          from app.email_attachment ea
          join app.email e on e.id = ea.email_id
          where ea.storage_path = storage.objects.name
            and app.can_read_segment(e.household_id, e.segment)
        )
      );
  end if;
end
$$;
