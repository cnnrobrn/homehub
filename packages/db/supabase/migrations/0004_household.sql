-- Migration: 0004_household.sql
-- Authored: 2026-04-20
-- Purpose: create the household / member / grant / invitation / person /
--          account_grant tables with RLS enabled and per-table policies.
-- Owner: @infra-platform
-- Spec: specs/02-data-model/schema.md + households.md + row-level-security.md.
--
-- This is the foundational M1 migration: every downstream app.* table keys
-- into app.household + app.member. The helper functions in 0003 are used
-- by the RLS policies below so policy bodies stay short and the membership
-- logic lives in one place.
--
-- Ordering note: app.account_grant references app.account, which does not
-- yet exist (0005 creates it). We declare account_grant here because it
-- belongs to the household/access-control cluster — the FK to account is
-- added in 0005 once the account table exists.
--
-- citext: emails are case-insensitive. The extension ships in Supabase; we
-- create it in the shared `extensions` schema (same home as pg_trgm etc.).

create extension if not exists citext with schema extensions;

-- --------------------------------------------------------------------------
-- app.household
-- --------------------------------------------------------------------------

create table if not exists app.household (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  -- on delete set null: keep the household if the creating auth.users row
  -- is ever removed (user leaves, account deleted). The household itself
  -- should survive as long as any other member exists.
  created_by  uuid references auth.users(id) on delete set null,
  settings    jsonb not null default '{}'::jsonb
);

alter table app.household enable row level security;
-- Defense in depth: revoke the default public grants that Postgres would
-- otherwise add via `postgres` role, so RLS is the only gate. service_role
-- bypasses RLS, authenticated goes through policies.
alter table app.household force row level security;

create index if not exists household_created_by_idx
  on app.household (created_by);

-- --------------------------------------------------------------------------
-- app.member
-- --------------------------------------------------------------------------

create table if not exists app.member (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.household(id) on delete cascade,
  -- user_id is nullable so we can model non-connected members (Grandma,
  -- a visiting nanny). When they accept an invite, the same row is
  -- upgraded — we do not swap member rows on invite acceptance.
  user_id       uuid references auth.users(id) on delete set null,
  display_name  text not null,
  role          text not null check (role in ('owner','adult','child','guest','non_connected')),
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,
  email         extensions.citext
);

alter table app.member enable row level security;
alter table app.member force row level security;

-- Partial unique: one user can have only one member row per household,
-- but multiple non-connected members in the same household are allowed
-- (user_id is null). Same idea for email — a household can track the same
-- person by email at most once.
create unique index if not exists member_household_user_unique
  on app.member (household_id, user_id)
  where user_id is not null;

create unique index if not exists member_household_email_unique
  on app.member (household_id, email)
  where email is not null;

create index if not exists member_household_idx
  on app.member (household_id);

create index if not exists member_household_role_idx
  on app.member (household_id, role);

create index if not exists member_user_idx
  on app.member (user_id)
  where user_id is not null;

-- --------------------------------------------------------------------------
-- app.member_segment_grant
-- --------------------------------------------------------------------------

create table if not exists app.member_segment_grant (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references app.member(id) on delete cascade,
  segment    text not null check (segment in ('financial','food','fun','social','system')),
  access     text not null check (access in ('none','read','write')),
  unique (member_id, segment)
);

alter table app.member_segment_grant enable row level security;
alter table app.member_segment_grant force row level security;

create index if not exists member_segment_grant_member_idx
  on app.member_segment_grant (member_id);

-- --------------------------------------------------------------------------
-- app.household_invitation
-- --------------------------------------------------------------------------

create table if not exists app.household_invitation (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references app.household(id) on delete cascade,
  email             extensions.citext not null,
  role              text not null check (role in ('owner','adult','child','guest')),
  proposed_grants   jsonb not null default '[]'::jsonb,
  -- token_hash: we never store the raw invite token. Server hmac-sha256s
  -- the token and stores the digest; the email carries the raw token.
  -- On redemption the server hashes the presented token and looks it up.
  -- This means a DB dump leak does not expose live invites.
  token_hash        text not null unique,
  expires_at        timestamptz not null,
  invited_by        uuid not null references app.member(id) on delete cascade,
  accepted_at       timestamptz,
  accepted_by       uuid references app.member(id) on delete set null,
  created_at        timestamptz not null default now()
);

alter table app.household_invitation enable row level security;
alter table app.household_invitation force row level security;

create index if not exists household_invitation_household_idx
  on app.household_invitation (household_id);

create index if not exists household_invitation_email_idx
  on app.household_invitation (email)
  where accepted_at is null;

-- --------------------------------------------------------------------------
-- app.person
-- --------------------------------------------------------------------------

create table if not exists app.person (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.household(id) on delete cascade,
  member_id     uuid references app.member(id) on delete set null,
  display_name  text not null,
  aliases       text[] not null default '{}',
  relationship  text,
  metadata      jsonb not null default '{}'::jsonb
);

alter table app.person enable row level security;
alter table app.person force row level security;

create index if not exists person_household_idx
  on app.person (household_id);

create index if not exists person_member_idx
  on app.person (member_id)
  where member_id is not null;

-- --------------------------------------------------------------------------
-- app.account_grant
--
-- FK to app.account is added in 0005 once the account table exists. We
-- store account_id as a plain uuid here; the FK becomes enforcing in the
-- next migration.
-- --------------------------------------------------------------------------

create table if not exists app.account_grant (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null,
  member_id   uuid not null references app.member(id) on delete cascade,
  access      text not null check (access in ('none','read','write')),
  unique (account_id, member_id)
);

alter table app.account_grant enable row level security;
alter table app.account_grant force row level security;

create index if not exists account_grant_account_idx
  on app.account_grant (account_id);

create index if not exists account_grant_member_idx
  on app.account_grant (member_id);

-- --------------------------------------------------------------------------
-- RLS policies
--
-- We drop-and-recreate policies so the migration is idempotent. Postgres
-- does not have `create policy if not exists` yet (as of PG17).
-- --------------------------------------------------------------------------

-- --- household ------------------------------------------------------------
drop policy if exists household_read on app.household;
create policy household_read on app.household
  for select
  using (app.is_member(id));

drop policy if exists household_insert on app.household;
-- Inserts are allowed only when the row's created_by matches the caller.
-- This is the household-creation path: the first owner inserts the row,
-- then inserts a matching app.member row (owner role) in the same txn.
create policy household_insert on app.household
  for insert
  with check (created_by = app.current_user_id());

drop policy if exists household_update on app.household;
create policy household_update on app.household
  for update
  using (
    exists (
      select 1 from app.member m
      where m.household_id = app.household.id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from app.member m
      where m.household_id = app.household.id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  );

drop policy if exists household_delete on app.household;
create policy household_delete on app.household
  for delete
  using (
    exists (
      select 1 from app.member m
      where m.household_id = app.household.id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  );

-- --- member ---------------------------------------------------------------
drop policy if exists member_read on app.member;
create policy member_read on app.member
  for select
  using (app.is_member(household_id));

drop policy if exists member_insert on app.member;
-- Two insert paths:
--   1) The household-creation bootstrap: caller is created_by of the
--      household and is inserting their own owner member row. We check
--      this by matching user_id to the caller AND role = 'owner' AND the
--      household has no other members yet.
--   2) An existing owner adds another member (invite flow, non-connected
--      person). Standard owner check.
create policy member_insert on app.member
  for insert
  with check (
    -- Bootstrap: caller is creating the first member row for a household
    -- they created; role must be 'owner'.
    (
      user_id = app.current_user_id()
      and role = 'owner'
      and exists (
        select 1 from app.household h
        where h.id = app.member.household_id
          and h.created_by = app.current_user_id()
      )
      and not exists (
        select 1 from app.member m2
        where m2.household_id = app.member.household_id
      )
    )
    -- Or: an existing owner is adding a member.
    or exists (
      select 1 from app.member m2
      where m2.household_id = app.member.household_id
        and m2.user_id = app.current_user_id()
        and m2.role = 'owner'
    )
  );

drop policy if exists member_update on app.member;
create policy member_update on app.member
  for update
  using (
    exists (
      select 1 from app.member m2
      where m2.household_id = app.member.household_id
        and m2.user_id = app.current_user_id()
        and m2.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from app.member m2
      where m2.household_id = app.member.household_id
        and m2.user_id = app.current_user_id()
        and m2.role = 'owner'
    )
  );

drop policy if exists member_delete on app.member;
create policy member_delete on app.member
  for delete
  using (
    exists (
      select 1 from app.member m2
      where m2.household_id = app.member.household_id
        and m2.user_id = app.current_user_id()
        and m2.role = 'owner'
    )
  );

-- --- member_segment_grant -------------------------------------------------
drop policy if exists member_segment_grant_read on app.member_segment_grant;
create policy member_segment_grant_read on app.member_segment_grant
  for select
  using (
    exists (
      select 1 from app.member m
      where m.id = app.member_segment_grant.member_id
        and app.is_member(m.household_id)
    )
  );

drop policy if exists member_segment_grant_write on app.member_segment_grant;
create policy member_segment_grant_write on app.member_segment_grant
  for all
  using (
    exists (
      select 1
      from app.member target
      join app.member caller on caller.household_id = target.household_id
      where target.id = app.member_segment_grant.member_id
        and caller.user_id = app.current_user_id()
        and caller.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from app.member target
      join app.member caller on caller.household_id = target.household_id
      where target.id = app.member_segment_grant.member_id
        and caller.user_id = app.current_user_id()
        and caller.role = 'owner'
    )
  );

-- --- household_invitation -------------------------------------------------
drop policy if exists household_invitation_read on app.household_invitation;
create policy household_invitation_read on app.household_invitation
  for select
  using (app.is_member(household_id));

drop policy if exists household_invitation_write on app.household_invitation;
create policy household_invitation_write on app.household_invitation
  for all
  using (
    exists (
      select 1 from app.member m
      where m.household_id = app.household_invitation.household_id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from app.member m
      where m.household_id = app.household_invitation.household_id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  );

-- --- person ---------------------------------------------------------------
drop policy if exists person_read on app.person;
create policy person_read on app.person
  for select
  using (app.is_member(household_id));

drop policy if exists person_write on app.person;
create policy person_write on app.person
  for all
  using (app.can_write_segment(household_id, 'social'))
  with check (app.can_write_segment(household_id, 'social'));

-- --- account_grant --------------------------------------------------------
-- Read policy uses the helper, which tolerates missing rows safely.
drop policy if exists account_grant_read on app.account_grant;
create policy account_grant_read on app.account_grant
  for select
  using (app.can_read_account(account_id));

-- Write policy references app.account, which is created in 0005. We
-- declare it in 0005 once the account table exists. Until then, the
-- absence of a write policy means authenticated cannot write — the
-- secure default.
