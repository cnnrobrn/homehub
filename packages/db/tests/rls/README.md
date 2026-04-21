# HomeHub RLS Tests

**Owner:** @infra-platform.

This directory contains the RLS assertion suite that the coordinator
briefing calls out as non-negotiable: every new table ships with at
least three policy tests.

## Style

Tests are plain SQL, run in a single psql session against a freshly
migrated database. Each test file does its own assertions via
`DO $$ BEGIN ASSERT ...; END $$` and raises on failure. pgTAP would
be marginally prettier but adds a binary dependency that is not yet
available in every environment the stack boots in. If that changes
we can move to pgTAP as a follow-up — the assertions themselves are
the load-bearing part.

## Layout

```
_setup.sql       — seeds two households (A, B), members, grants, one
                   fixture row per app.* table. Runs once at start.
_helpers.sql     — `act_as(uuid)` sets the JWT sub + switches to the
                   `authenticated` role; `act_as_service()` returns to
                   service_role.
*_test.sql       — per-table tests. Pattern: three assertions each:
                   1) in-household read sees the row
                   2) out-of-household read returns zero rows
                   3) write without grant fails
```

## How the runner works

`pnpm --filter @homehub/db db:test` applies every migration to a
freshly-booted local stack, loads `_setup.sql` and `_helpers.sql`,
then runs every `*_test.sql` file. The runner exits non-zero on the
first assertion failure. CI runs the same command in the
`rls-tests` job.

Tests rely on `set local role authenticated` + `set_config('request.jwt.claim.sub', ...)`.
That is the exact pattern Supabase's PostgREST layer uses to
impersonate an end user; RLS policies see the uid via `auth.uid()`.
