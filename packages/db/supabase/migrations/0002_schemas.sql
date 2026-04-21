-- Migration: 0002_schemas.sql
-- Authored: 2026-04-20
-- Purpose: create the five HomeHub application schemas and grant baseline
--          USAGE to the roles that need it. No tables are created here;
--          tables land in M1 (app.*), M1 (sync.*, audit.*) and M3 (mem.*).
--          `jobs` is reserved for pgmq-managed tables; pgmq creates its
--          own `pgmq` schema, but we keep `jobs` as the canonical name
--          the rest of the codebase references per specs/02-data-model/schema.md.
-- Owner: @infra-platform
-- Spec: specs/02-data-model/schema.md (Schemas section).
--
-- Role model (per specs/09-security/auth.md):
--   - authenticated: end-user JWT role; hits PostgREST. Gets USAGE so RLS
--     can later gate access at the row level.
--   - service_role:  background workers bypass RLS; needs USAGE everywhere.
--   - postgres:      superuser; useful for migrations and psql operators.
--   - anon:          intentionally NOT granted. Anonymous access is out of
--                    scope for HomeHub (specs/09-security/auth.md).
--
-- All statements idempotent: `create schema if not exists` + grant is safe
-- to re-run. Grants on a schema are additive and do not error on repeat.

create schema if not exists app;
create schema if not exists mem;
create schema if not exists sync;
create schema if not exists jobs;
create schema if not exists audit;

grant usage on schema app   to authenticated, service_role, postgres;
grant usage on schema mem   to authenticated, service_role, postgres;
grant usage on schema sync  to authenticated, service_role, postgres;
grant usage on schema jobs  to authenticated, service_role, postgres;
grant usage on schema audit to authenticated, service_role, postgres;
