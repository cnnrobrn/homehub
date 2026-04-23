# HomeHub ops — top-level runbook

This directory is the **operator playbook** for running HomeHub in
production. The targeted audience is a staff engineer on call.

The related spec (`specs/10-operations/*`) describes what the system is
**designed** to do; the docs here describe what **you** do when the
system misbehaves.

## Surface map

| Surface             | Owner       | Where                                   |
| ------------------- | ----------- | --------------------------------------- |
| Web app             | Vercel      | `https://app.homehub.ing`               |
| Workers             | Railway     | `apps/workers/*` services               |
| Nango               | Railway     | `infra/nango/` — see production-deploy  |
| Postgres + Storage  | Supabase    | project dashboard                       |
| Error reporting     | Sentry      | projects: homehub-web, homehub-workers  |
| Internal dashboards | HomeHub web | `/ops/{dlq,model-usage,health}` (owner) |

## Runbooks

- [`deployment.md`](./deployment.md) — how code + migrations ship.
- [`runbooks/dlq-replay.md`](./runbooks/dlq-replay.md) — triage a dead-letter alert.
- [`runbooks/model-budget-breach.md`](./runbooks/model-budget-breach.md) — respond to a household budget breach.
- [`runbooks/worker-down.md`](./runbooks/worker-down.md) — a worker stopped emitting heartbeats.
- [`runbooks/incident-response.md`](./runbooks/incident-response.md) — incident lifecycle + post-mortem template.
- [`backup-restore.md`](./backup-restore.md) — how we export and (manually) restore household data.

## Related

- [`specs/10-operations/observability.md`](../../specs/10-operations/observability.md)
- [`specs/10-operations/deployment.md`](../../specs/10-operations/deployment.md)
- [`infra/nango/docs/production-deploy.md`](../../infra/nango/docs/production-deploy.md)
