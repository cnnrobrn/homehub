-- RLS test helpers.
--
-- act_as(uuid): impersonate a Supabase user. Sets the JWT sub claim that
-- auth.uid() reads and switches to the `authenticated` role. All
-- subsequent statements in the same transaction / session run under RLS
-- with that user's identity.
--
-- act_as_service(): reset to the `service_role`, which bypasses RLS.
-- Useful between tests to insert fixture data without policy checks.
--
-- NOTE: `set local` requires a txn; `set role` in a session works. We
-- scope both via `set ... ` (session-wide) so tests can call `act_as`
-- outside of explicit BEGIN/COMMIT blocks.

create or replace function public.act_as(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, false);
  execute 'set role authenticated';
end
$$;

create or replace function public.act_as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role service_role';
end
$$;

-- Assert helper: raise with a descriptive message if a boolean is false.
-- Using `assert` directly gives an opaque "assertion failed" error; this
-- wrapper carries the test name so a failing run points at the spot.
create or replace function public.rls_assert(condition boolean, name text)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception 'RLS TEST FAILED: %', name using errcode = 'P0001';
  end if;
end
$$;

-- Grant service_role read access to auth.users so test files (running
-- under `act_as_service`) can reference the fixture users. INSERT on
-- auth.users isn't grantable from this role, so `_setup.sql` seeds
-- auth.users as the postgres connection role before calling
-- `act_as_service`.
grant select on auth.users to service_role;

-- Grant table-level privileges on every application schema to both
-- service_role (for `act_as_service` fixture inserts) and authenticated
-- (for `act_as(uuid)` test reads, which are then gated by RLS
-- policies). Migration 0015 now grants the same privileges in
-- production; these lines are kept as a belt-and-braces guard so the
-- test suite works even when run against a DB that pre-dates 0015
-- (e.g. a shadow DB reset from an older migration set). postgres owns
-- these tables so the grants land fully.
grant select, insert, update, delete on all tables in schema app to service_role, authenticated;
grant select, insert, update, delete on all tables in schema mem to service_role, authenticated;
grant select, insert, update, delete on all tables in schema sync to service_role, authenticated;
grant select, insert, update, delete on all tables in schema audit to service_role, authenticated;
grant usage, select on all sequences in schema app to service_role, authenticated;
grant usage, select on all sequences in schema mem to service_role, authenticated;
grant usage, select on all sequences in schema sync to service_role, authenticated;
grant usage, select on all sequences in schema audit to service_role, authenticated;
