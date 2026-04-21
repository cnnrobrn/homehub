-- Migration: 0003_auth_helpers.sql
-- Authored: 2026-04-20
-- Purpose: install the RLS helper functions every app.* policy depends on
--          (is_member, member_id, can_read/write_segment, can_read/write_account).
-- Owner: @infra-platform
-- Spec: specs/02-data-model/row-level-security.md.
--
-- All helpers live in schema `app`. They are `security definer` so they can
-- read membership/grant tables regardless of the caller's RLS context — the
-- helpers themselves perform the authorization check, so SECURITY DEFINER is
-- the safe way to avoid policy recursion (an RLS policy that references a
-- query that is itself RLS-gated deadlocks). `set search_path = app, public`
-- on every function closes the classic search-path hijack CVE surface.
--
-- Implementation note: these helpers reference tables (app.member,
-- app.account, app.account_grant) that are created in 0004/0005. Postgres
-- validates a `language sql` function body against the catalog at creation
-- time, but `language plpgsql` defers reference resolution until first
-- execution. We therefore use plpgsql even for one-liners so the helpers
-- can be declared ahead of the tables they reference without forward-
-- declaring the tables. By the time an RLS policy calls one of these
-- helpers, the tables exist.
--
-- All helpers return false / null safely when any lookup fails (null arg,
-- unauthenticated caller, nonexistent household, etc.). This matters
-- because RLS policies evaluate these helpers for every row touched — a
-- thrown exception inside a helper would turn a missing-grant case into
-- an opaque 500 rather than a clean "no rows visible".
--
-- Execution grants: `authenticated` can call all helpers (they are the JWT
-- role that hits PostgREST). `service_role` bypasses RLS anyway so it
-- does not need them, but granting execute is harmless and avoids
-- confusing errors if a worker misconfigures its client. `anon` is
-- intentionally not granted — anonymous access is out of scope.

-- app.current_user_id() — thin wrapper around auth.uid().
--
-- Wrapping auth.uid() lets us swap in a different identity source later
-- (e.g. a hook-injected claim) without touching every policy.
create or replace function app.current_user_id()
returns uuid
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  return auth.uid();
end
$$;

-- app.is_member(h) — true iff the calling user has a member row in
-- household `h`. The uid() check is baked in.
create or replace function app.is_member(h uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  uid uuid := auth.uid();
  found boolean;
begin
  if h is null or uid is null then
    return false;
  end if;
  select exists (
    select 1 from app.member m
    where m.household_id = h and m.user_id = uid
  ) into found;
  return coalesce(found, false);
end
$$;

-- app.member_id(h) — resolve the caller's member id in household `h`.
-- Returns null if the caller is not a member.
create or replace function app.member_id(h uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  uid uuid := auth.uid();
  result uuid;
begin
  if h is null or uid is null then
    return null;
  end if;
  select m.id into result
  from app.member m
  where m.household_id = h and m.user_id = uid
  limit 1;
  return result;
end
$$;

-- app.can_read_segment(h, segment) — true iff the caller has read OR
-- write access to `segment` in household `h`. Write implies read.
create or replace function app.can_read_segment(h uuid, segment text)
returns boolean
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  uid uuid := auth.uid();
  found boolean;
begin
  if h is null or uid is null or segment is null then
    return false;
  end if;
  select exists (
    select 1
    from app.member m
    join app.member_segment_grant g on g.member_id = m.id
    where m.household_id = h
      and m.user_id = uid
      and g.segment = can_read_segment.segment
      and g.access in ('read', 'write')
  ) into found;
  return coalesce(found, false);
end
$$;

-- app.can_write_segment(h, segment) — true iff the caller has write
-- access to `segment` in household `h`.
create or replace function app.can_write_segment(h uuid, segment text)
returns boolean
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  uid uuid := auth.uid();
  found boolean;
begin
  if h is null or uid is null or segment is null then
    return false;
  end if;
  select exists (
    select 1
    from app.member m
    join app.member_segment_grant g on g.member_id = m.id
    where m.household_id = h
      and m.user_id = uid
      and g.segment = can_write_segment.segment
      and g.access = 'write'
  ) into found;
  return coalesce(found, false);
end
$$;

-- app.can_read_account(account_id) — per-account visibility override.
-- Joins through account_grant; falls back to segment-grant on Financial
-- if no per-account row exists.
create or replace function app.can_read_account(account_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  uid uuid := auth.uid();
  per_account boolean;
  per_segment boolean;
begin
  if account_id is null or uid is null then
    return false;
  end if;

  -- Per-account grant wins when present.
  select exists (
    select 1
    from app.account_grant ag
    join app.member m on m.id = ag.member_id
    where ag.account_id = can_read_account.account_id
      and m.user_id = uid
      and ag.access in ('read', 'write')
  ) into per_account;
  if coalesce(per_account, false) then
    return true;
  end if;

  -- Fall back to segment-level Financial grant, unless an explicit
  -- `none` per-account deny overrides.
  select exists (
    select 1
    from app.account a
    join app.member m on m.household_id = a.household_id
    join app.member_segment_grant g on g.member_id = m.id
    where a.id = can_read_account.account_id
      and m.user_id = uid
      and g.segment = 'financial'
      and g.access in ('read', 'write')
      and not exists (
        select 1
        from app.account_grant ag2
        where ag2.account_id = a.id
          and ag2.member_id = m.id
          and ag2.access = 'none'
      )
  ) into per_segment;
  return coalesce(per_segment, false);
end
$$;

-- app.can_write_account(account_id) — write variant; write grant
-- required in either the per-account or segment grant.
create or replace function app.can_write_account(account_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  uid uuid := auth.uid();
  per_account boolean;
  per_segment boolean;
begin
  if account_id is null or uid is null then
    return false;
  end if;

  select exists (
    select 1
    from app.account_grant ag
    join app.member m on m.id = ag.member_id
    where ag.account_id = can_write_account.account_id
      and m.user_id = uid
      and ag.access = 'write'
  ) into per_account;
  if coalesce(per_account, false) then
    return true;
  end if;

  select exists (
    select 1
    from app.account a
    join app.member m on m.household_id = a.household_id
    join app.member_segment_grant g on g.member_id = m.id
    where a.id = can_write_account.account_id
      and m.user_id = uid
      and g.segment = 'financial'
      and g.access = 'write'
      and not exists (
        select 1
        from app.account_grant ag2
        where ag2.account_id = a.id
          and ag2.member_id = m.id
          and ag2.access in ('none', 'read')
      )
  ) into per_segment;
  return coalesce(per_segment, false);
end
$$;

grant execute on function app.current_user_id()             to authenticated, service_role;
grant execute on function app.is_member(uuid)               to authenticated, service_role;
grant execute on function app.member_id(uuid)               to authenticated, service_role;
grant execute on function app.can_read_segment(uuid, text)  to authenticated, service_role;
grant execute on function app.can_write_segment(uuid, text) to authenticated, service_role;
grant execute on function app.can_read_account(uuid)        to authenticated, service_role;
grant execute on function app.can_write_account(uuid)       to authenticated, service_role;
