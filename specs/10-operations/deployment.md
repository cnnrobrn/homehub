# Deployment

**Purpose.** How code gets from PR to production.

**Scope.** Pipelines, migrations, rollbacks, feature-flag rollout.

## Pipeline

1. PR opened → CI runs lint, typecheck, unit, integration (subset), migration lint.
2. Vercel preview deployed; workers are not re-deployed per-PR.
3. Review + merge to `main`.
4. On merge:
   - Vercel deploys the web app to staging.
   - Railway redeploys changed worker services to staging (only changed — Docker layer caching keeps this cheap).
   - Staging migrations apply automatically.
5. Smoke tests run against staging (see [`../11-testing/strategy.md`](../11-testing/strategy.md)).
6. Human promote-to-prod in the deploy dashboard.
7. Production Vercel + Railway + migrations apply.

## Migrations

- Tool: Supabase CLI-compatible SQL files under `packages/db/migrations`.
- Forward-only. No down-migrations.
- Every migration reviewed for lock behavior on a 50k-row baseline dataset.
- Migrations that touch hot tables (`app.transaction`, `app.event`) use `CREATE INDEX CONCURRENTLY`, avoid `ALTER TYPE`, and run during off-peak windows when possible.

## RLS and migration interaction

Any migration that adds a new table must include its RLS policies in the same migration. A CI check rejects migrations that introduce a table without `alter table ... enable row level security` and at least one policy.

## Rollback

- Web: Vercel instant rollback to previous build.
- Workers: Railway redeploy of previous image tag.
- DB: no down-migrations; rollback is by forward-fix migration. Any destructive migration (drop column / drop table) is split into two releases — deprecate first, drop later.

## Feature flags

- Flags are evaluated server-side.
- Flags used primarily for **progressive rollout** of new worker behavior (e.g., new enrichment prompt): enable for 10% of households, observe, expand.
- For user-facing UI, flags are sparingly used and always off by default.

## Secrets rotation

- Quarterly rotation for service role, OpenRouter key, Nango secret.
- Immediate rotation on known exposure.
- Rotations are zero-downtime: provision new → update services → revoke old.

## Dependencies

- [`../01-architecture/environments.md`](../01-architecture/environments.md)
- [`observability.md`](./observability.md)
