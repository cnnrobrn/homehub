# Workers (Railway)

**Purpose.** How workers are packaged, deployed, and operated.

**Scope.** Complements [`../05-agents/workers.md`](../05-agents/workers.md) (which describes *what* workers do). This doc is about the *how*.

## Package layout

```
apps/workers/
  sync-gcal/
  sync-gmail/
  sync-financial/
  sync-grocery/
  webhook-ingest/
  enrichment/
  node-regen/
  reconciler/
  pantry-diff/
  summaries/
  alerts/
  suggestions/
  action-executor/
  backfill/
packages/
  worker-runtime/   # shared base
  providers/        # nango-backed adapters
  prompts/          # model prompts
  shared/           # types, utils
```

Each `apps/workers/*` is a tiny entrypoint that imports the runtime and the handler. All shared logic is in `packages/*`.

## Build / deploy

- Single Dockerfile template per worker; `pnpm --filter` to include only what's needed.
- Railway service per worker class.
- Images tagged with git SHA; rollback = redeploy tag.
- Deploys triggered by merges to `main` for staging; manual promote for prod.

## Configuration

- Environment per worker: secrets come from Railway variables.
- Shared config (e.g., Supabase URL) lives in a base `.env.base` referenced in Railway config.
- No config in code.

## Scaling

- Horizontal on Railway.
- Scaling signal: queue depth primary, p95 duration secondary.
- Some workers (sync-gcal) are steady rate; others (enrichment) are bursty — tuned independently.

## Health

- `/health` and `/ready` endpoints.
- Prometheus-style metrics endpoint `/metrics` (OpenTelemetry → Grafana/Axiom).
- Heartbeat row in `sync.worker_heartbeat` every 30s so we can detect silently-stuck workers.

## Graceful shutdown

- SIGTERM → stop claiming new jobs → drain in-flight → exit.
- Shutdown window: 30s default; workers with longer tasks (enrichment batches) extend.

## Secrets

- No secrets in repo.
- Service role key (Supabase), OpenRouter key, Nango secret key — all Railway-scoped.
- Workers never receive user-level Supabase tokens.

## Dependencies

- [`../05-agents/workers.md`](../05-agents/workers.md)
- [`../10-operations/observability.md`](../10-operations/observability.md)
