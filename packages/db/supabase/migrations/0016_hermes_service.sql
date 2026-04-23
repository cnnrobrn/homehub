-- Per-household pointer to the family's Hermes Agent state in GCS.
--
-- Chat is powered by Hermes Agent (github.com/NousResearch/hermes-agent).
-- Each chat turn spawns a short-lived Cloud Run Sandbox that:
--   1. Hydrates ${HERMES_HOME} from GCS (gs://<bucket>/<prefix>/...)
--   2. Runs `hermes chat` for the turn
--   3. Persists changes back to GCS
--   4. Is destroyed
--
-- We therefore don't store a long-lived service URL or sandbox id.
-- We store the GCS prefix where the family's state lives, plus a
-- one-off "initialized" timestamp so we can tell a brand-new family
-- from one whose state was bootstrapped.
--
-- `hermes_state_bucket` is tracked separately from the router's env
-- default so we can migrate individual families to a different bucket
-- (per-region, per-tier) without a schema change.

alter table app.household
  add column if not exists hermes_state_bucket  text,
  add column if not exists hermes_state_prefix  text,
  add column if not exists hermes_initialized_at timestamptz,
  -- Archive on household delete. Non-null means the family's state has
  -- been soft-deleted; the chat path should refuse to spawn a sandbox
  -- for them. A daily cleanup job hard-deletes GCS prefixes whose
  -- `hermes_archived_at` is older than the retention window (default
  -- 30 days). Clearing this column ("unarchive") restores the family.
  add column if not exists hermes_archived_at timestamptz;

-- The prefix is null-or-unique per bucket — we never want two
-- households pointing at the same state.
create unique index if not exists household_hermes_state_unique
  on app.household (hermes_state_bucket, hermes_state_prefix)
  where hermes_state_bucket is not null and hermes_state_prefix is not null;

-- Cleanup-job index: scan archived prefixes older than the retention
-- window. Partial so it stays small as most rows are not archived.
create index if not exists household_hermes_archived_at_idx
  on app.household (hermes_archived_at)
  where hermes_archived_at is not null;
