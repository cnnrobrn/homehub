# Deployment

The authoritative pipeline lives in
[`specs/10-operations/deployment.md`](../../specs/10-operations/deployment.md).
This page is the operator cheat-sheet.

## Environments

| Environment | Web                        | Workers               | DB                  |
| ----------- | -------------------------- | --------------------- | ------------------- |
| Staging     | Vercel Preview (`staging`) | Railway `staging` env | Supabase staging    |
| Production  | Vercel Production (`prod`) | Railway `prod` env    | Supabase production |

Secrets are per-environment. No prod secret is ever present in a staging
service; see [`specs/09-security/auth.md`](../../specs/09-security/auth.md).

## Promotion flow

1. PR merges to `main` →
2. Vercel deploys web to staging.
3. Railway rebuilds changed workers → staging.
4. Supabase migrations apply automatically to staging (forward-only).
5. Smoke tests run.
6. A human clicks **Promote to prod** in the deploy dashboard.
7. Prod Vercel + Railway + migrations roll.

There is no automated promote. A destructive migration (drop column /
drop table) lands as **two** deploys per
[`specs/10-operations/deployment.md`](../../specs/10-operations/deployment.md#rollback).

## Rollback

- **Web:** Vercel → Deployments → Promote previous build.
- **Workers:** Railway → Service → Deployments → Redeploy previous image.
- **DB:** no rollback. Ship a forward-fix migration; if time-critical,
  scale the offending worker to zero first so bad data can't proliferate.

## Secrets rotation

Quarterly or on known exposure:

- Supabase service role: Supabase dashboard → Project Settings → API → Regenerate.
- OpenRouter API key: OpenRouter dashboard.
- Nango secret key: Nango admin UI; also update every worker's
  `NANGO_SECRET_KEY`.
- Sentry DSN: Sentry project settings.

Rotation must be **zero-downtime**: provision the new secret, update
services one-by-one, revoke the old. Never both at once.

## CI gates

- lint, typecheck, tests — must be green.
- log-field lint — advisory (warn-mode); once workers migrate off
  direct `console.*`, flip the script to strict in CI.
- migration lint — strict; a migration without RLS is rejected.
- RLS pgTAP — strict; every table must have policies.
