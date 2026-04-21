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
-- under `act_as_service`) can reference the fixture users. INSERT isn't
-- grantable through a plain GRANT because auth.users has FORCE ROW
-- LEVEL SECURITY in Supabase CLI 2.90.0's bundled Postgres — the
-- fixture seeds users by briefly `SET ROLE supabase_auth_admin` in
-- `_setup.sql` (the role that owns auth.users) instead.
grant select on auth.users to service_role;
