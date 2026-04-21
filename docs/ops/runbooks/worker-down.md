# Runbook — worker down / no heartbeat

**Trigger:** `/ops/health` reports a stale heartbeat (> 10 min) for a
worker, or a Railway health-check alarm fires, or a queue is backing
up and no worker is claiming.

## 1. Confirm

`/ops/health` has four signals:

- Worker heartbeats (stale vs. ok).
- Queue depths and age-of-oldest.
- Active provider connections per household.
- Recent audit events.

If the heartbeat row is stale, the worker is either restarting, dead,
or the heartbeat table itself is unreachable. Check Railway for the
same service — is it crashing?

## 2. Triage

- Railway UI → `worker-<name>` → Metrics. CPU / RAM / restart count.
- `railway logs -s worker-<name> --tail 200`. Look for:
  - `env validation failed` → misconfigured secret; fix and redeploy.
  - `Supabase ... fetch failed` → Supabase reachability; check Supabase
    status.
  - `OpenRouter 401` → rotated key not yet picked up; redeploy.
  - `pgmq ... unavailable` → extension not loaded; contact Supabase
    support / roll forward with a migration.
- `curl https://<service>.railway.app/health` from outside; confirm 200.

## 3. Recover

- **Ephemeral crash (OOM, flaky provider):** Railway's restart policy
  will already be trying. If it's stuck, trigger a manual redeploy.
- **Config bug:** fix the env var / secret in Railway, then redeploy.
- **Code bug:** identify the PR that broke it, revert. DO NOT hot-fix
  on prod.

## 4. After recovery

- Verify queue depths drain on `/ops/health`.
- Run `pnpm --filter @homehub/dlq-admin dlq list --limit 25` — if the
  worker was crashing on messages, they may now be in the DLQ.
  Follow [`dlq-replay.md`](./dlq-replay.md).
- Write up the timeline via
  [`incident-response.md`](./incident-response.md).

## 5. Guardrails

- The structured logger requires `service` and `component` on every
  line (enforced by `scripts/lint-log-fields.ts`). If a worker's
  outage produces logs without these fields, **do not move on** —
  the root cause is likely a bare `console.*` path.
- Heartbeats should come in every 60s (see `startHeartbeatLoop`). If
  the interval is drifting, check event-loop saturation — a worker
  that's too busy to fire a heartbeat is effectively dead for
  correlation purposes.
