-- Migration: 0020_google_oauth.sql
-- Authored: 2026-04-24
-- Purpose: stand up the native Google OAuth broker replacing Nango for
--          Gmail + Calendar. Adds `sync.google_connection` (encrypted
--          refresh-token vault keyed per household+provider+google_sub)
--          and `sync.google_oauth_state` (short-lived PKCE + state scratch
--          pad used between /api/oauth/google/start and /callback).
-- Owner: @integrations
-- Spec: specs/03-integrations/google-oauth.md
--
-- Relationship to `sync.provider_connection`:
--   `sync.provider_connection` remains the user-visible connections list
--   (one row per active third-party integration per household). Its
--   `nango_connection_id` column now carries a UUID pointing at
--   `sync.google_connection(id)` for rows whose `provider` is 'gcal' or
--   'gmail' — the column name is retained on purpose so the read-side
--   diff stays tiny. YNAB rows continue to carry the real Nango id.
--
-- Token custody:
--   Refresh tokens are encrypted at rest with AES-256-GCM. The key lives
--   in `GOOGLE_TOKEN_ENCRYPTION_KEY_V{N}` env vars (base64 32-byte).
--   `key_version` on each row points at the env var that was active
--   when the row was written. Rotation: provision V2, backfill via a
--   one-off re-encrypt job, retire V1. No app code cares about which
--   key version a row used — the crypto helper looks it up at read time.
--
-- RLS stance:
--   `sync.google_connection` — service-role only. The ciphertext columns
--   must NEVER be exposed to the `authenticated` role even by accident.
--   The user-visible surface reads `sync.provider_connection` instead,
--   which has the 'active'/'revoked' status and no token material.
--   `sync.google_oauth_state` — service-role only. Written by the web
--   /start route, consumed+deleted by /callback. Nobody else reads it.

-- --------------------------------------------------------------------------
-- sync.google_connection
-- --------------------------------------------------------------------------

create table if not exists sync.google_connection (
  id                          uuid primary key default gen_random_uuid(),
  household_id                uuid not null references app.household(id) on delete cascade,
  member_id                   uuid references app.member(id) on delete set null,
  provider                    text not null check (provider in ('gcal', 'gmail')),
  -- Google's stable user id (from the id_token `sub` claim). We key
  -- uniqueness on (household, provider, google_sub) so a re-auth of the
  -- same Google account upserts rather than duplicating.
  google_sub                  text not null,
  email                       text not null,
  scopes                      text[] not null,

  -- Refresh token (long-lived; required for silent refresh). Google only
  -- returns a refresh token on the first consent — our start route always
  -- sends `prompt=consent` to guarantee one on reconnect.
  -- All ciphertext / iv / auth_tag columns are base64 strings (AES-256-GCM
  -- outputs raw bytes; we encode base64 on write so PostgREST round-trips
  -- cleanly without the bytea hex-escape ambiguity).
  refresh_token_ciphertext    text not null,
  refresh_token_iv            text not null,
  refresh_token_auth_tag      text not null,

  -- Access token (short-lived, ~1 hour). Cached so concurrent workers
  -- don't all hammer Google's /token endpoint; transparently re-minted
  -- by `GoogleHttpClient.proxy` when `access_token_expires_at` is near.
  access_token_ciphertext     text,
  access_token_iv             text,
  access_token_auth_tag       text,
  access_token_expires_at     timestamptz,

  key_version                 smallint not null default 1,

  status                      text not null default 'active'
                                check (status in ('active', 'errored', 'revoked')),
  last_refreshed_at           timestamptz,
  -- Mirror of `sync.provider_connection.id` for the user-visible peer
  -- row. Nullable for the migration gap where the callback writes
  -- google_connection first, then the peer — the /callback route fills
  -- this before returning to the caller.
  provider_connection_id      uuid references sync.provider_connection(id) on delete set null,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  unique (household_id, provider, google_sub)
);

alter table sync.google_connection enable row level security;
alter table sync.google_connection force row level security;

create index if not exists google_connection_household_idx
  on sync.google_connection (household_id);

create index if not exists google_connection_provider_status_idx
  on sync.google_connection (provider, status);

create index if not exists google_connection_peer_idx
  on sync.google_connection (provider_connection_id)
  where provider_connection_id is not null;

-- No policies for `authenticated` — service_role only. The user-visible
-- connection list reads `sync.provider_connection`, which already has
-- its own RLS policy allowing household members to read their own rows.

-- --------------------------------------------------------------------------
-- sync.google_oauth_state
--
-- Short-lived scratchpad for the OAuth dance. /start inserts a row,
-- /callback deletes it on consume. Rows older than 10 minutes are
-- meaningless (Google's authorize redirect will have failed or timed
-- out); a daily cron may vacuum them, but nothing depends on cleanup.
-- --------------------------------------------------------------------------

create table if not exists sync.google_oauth_state (
  state               text primary key,
  code_verifier       text not null,
  household_id        uuid not null references app.household(id) on delete cascade,
  member_id           uuid not null references app.member(id) on delete cascade,
  provider            text not null check (provider in ('gcal', 'gmail')),
  requested_scopes    text[] not null,
  -- Gmail-only; persisted onto the resulting `sync.provider_connection`
  -- metadata when the callback fires so the sync worker knows which
  -- categories to ingest. Null for gcal.
  email_categories    text[],
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '10 minutes'
);

alter table sync.google_oauth_state enable row level security;
alter table sync.google_oauth_state force row level security;

create index if not exists google_oauth_state_expires_idx
  on sync.google_oauth_state (expires_at);

-- No policies for `authenticated` — service_role only.
