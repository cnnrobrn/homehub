-- Migration: 0021_event_upsert_unique_index.sql
-- Purpose: replace the partial unique index on app.event with a
--          non-partial one so PostgREST's `ON CONFLICT (household_id,
--          provider, source_id)` upsert (used by sync-gcal) can target
--          it. PostgREST cannot pass the partial-index `WHERE` clause
--          alongside the conflict tuple, so a partial index is invisible
--          to its inferred-conflict-target form.
-- Owner: @integrations

-- The original index from migration 0005 was:
--   create unique index event_provider_source_unique
--     on app.event (household_id, provider, source_id)
--     where provider is not null and source_id is not null;
-- Default PostgreSQL semantics already treat NULLs as distinct in unique
-- indexes, so removing the WHERE clause is functionally equivalent —
-- rows with NULL provider/source_id remain non-conflicting.

drop index if exists app.event_provider_source_unique;

create unique index if not exists event_provider_source_unique
  on app.event (household_id, provider, source_id);
