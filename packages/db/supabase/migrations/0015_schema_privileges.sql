-- Migration: 0015_schema_privileges.sql
-- Authored: 2026-04-22
-- Purpose: grant table-level DML privileges on every HomeHub application
--          schema to the `authenticated` and `service_role` Postgres roles,
--          and set default privileges so future tables in these schemas
--          inherit the same grants automatically.
-- Owner: @infra-platform
-- Spec:  specs/02-data-model/row-level-security.md, specs/09-security/auth.md.
--
-- Why this exists
-- ---------------
-- Supabase's hosted Postgres seeds default privileges for the `public`
-- schema only — authenticated and service_role get ALL on TABLES in public
-- by default. Custom schemas (`app`, `mem`, `sync`, `audit`) get USAGE via
-- 0002_schemas.sql but NO table-level DML. Without these grants, every
-- PostgREST call from the web app (which runs as `authenticated`) fails
-- with "permission denied for table <name>" before RLS policies even
-- evaluate — and that is exactly the post-login 500 the `/api/diag/auth`
-- diagnostic was added to chase down.
--
-- RLS still enforces household isolation. Granting SELECT/INSERT/UPDATE/
-- DELETE at the role level only tells Postgres "this role is allowed to
-- attempt these commands"; row visibility and writability remain gated by
-- the RLS policies declared in 0004–0014. Schemas that intentionally have
-- no `authenticated` policies (audit, sync.cursor, sync.dead_letter,
-- sync.worker_heartbeat) remain inaccessible to the JWT role because RLS
-- denies every row — the DML grant is harmless in that case.
--
-- `service_role` has BYPASSRLS on Supabase, but still needs explicit
-- table-level privileges to perform DML on non-public schemas. Grants
-- here close that gap for the background workers and the service-role
-- paths in `@homehub/auth-server` (invitation lookup, audit writes, the
-- bootstrap household-creation insert).
--
-- Idempotency
-- -----------
-- `GRANT … ON ALL TABLES IN SCHEMA` is additive and safe to re-run. The
-- `ALTER DEFAULT PRIVILEGES` statements are likewise additive — repeated
-- runs produce the same catalog state.

-- --------------------------------------------------------------------------
-- Existing tables
-- --------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema app
  to authenticated, service_role;
grant select, insert, update, delete on all tables in schema mem
  to authenticated, service_role;
grant select, insert, update, delete on all tables in schema sync
  to authenticated, service_role;
grant select, insert, update, delete on all tables in schema audit
  to authenticated, service_role;

-- Sequences back any `serial`/`identity` columns. None today but cheap
-- insurance; a missed sequence grant surfaces as a cryptic "permission
-- denied for sequence" mid-insert.
grant usage, select on all sequences in schema app
  to authenticated, service_role;
grant usage, select on all sequences in schema mem
  to authenticated, service_role;
grant usage, select on all sequences in schema sync
  to authenticated, service_role;
grant usage, select on all sequences in schema audit
  to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Default privileges for future tables
-- --------------------------------------------------------------------------
--
-- Migrations run as the `postgres` role on Supabase (CLI and hosted). Any
-- table created by `postgres` in these schemas after this migration ships
-- will inherit the grants below, so future migrations do not have to
-- remember to re-grant.

alter default privileges for role postgres in schema app
  grant select, insert, update, delete on tables
  to authenticated, service_role;
alter default privileges for role postgres in schema mem
  grant select, insert, update, delete on tables
  to authenticated, service_role;
alter default privileges for role postgres in schema sync
  grant select, insert, update, delete on tables
  to authenticated, service_role;
alter default privileges for role postgres in schema audit
  grant select, insert, update, delete on tables
  to authenticated, service_role;

alter default privileges for role postgres in schema app
  grant usage, select on sequences
  to authenticated, service_role;
alter default privileges for role postgres in schema mem
  grant usage, select on sequences
  to authenticated, service_role;
alter default privileges for role postgres in schema sync
  grant usage, select on sequences
  to authenticated, service_role;
alter default privileges for role postgres in schema audit
  grant usage, select on sequences
  to authenticated, service_role;
