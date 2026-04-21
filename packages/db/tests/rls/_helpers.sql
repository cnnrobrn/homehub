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

-- Grant service_role direct access to auth.users so `_setup.sql` can
-- seed fixture users (alice/adam/bob) under `act_as_service`. Supabase
-- CLI 2.90.0's bundled Postgres locks auth.users down to the `supabase_auth_admin`
-- role by default; prior versions left service_role with implicit
-- access. Without this grant, the seed insert fails with "permission
-- denied for table users". Runs as the postgres superuser (this script
-- is loaded before any role switch) so it always succeeds.
grant select, insert, update, delete on auth.users to service_role;
