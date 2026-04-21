# `@homehub/worker-runtime`

Shared runtime for every HomeHub background worker. Workers under
`apps/workers/*` are thin entrypoints that compose this package with
their own handler.

## What it gives you

- `createServiceClient(env)` / `createAnonClient(env)` — typed Supabase
  clients. The service client is your default; anon is only for the
  rare worker that reads truly-public data.
- `createQueueClient(supabase)` — pgmq wrapper with
  `send`/`sendBatch`/`claim`/`ack`/`nack`/`deadLetter`/`depth`/
  `ageOfOldestSec`. Envelopes are validated on send and on claim.
- `queueNames` + `staticQueueNames` — single source of truth for queue
  names. Templated queues (`sync_full:{provider}`, etc.) come from
  builder functions; don't scatter literals through the codebase.
- `createNangoClient(env)` — wraps `@nangohq/node`. Every outbound
  provider call goes through Nango; refresh-token handling lives there,
  not here.
- `createModelClient(env, { supabase, logger })` — OpenRouter helper
  with default params merged by task, JSON mode + Zod validation + one
  corrective retry, automatic fallback model, and per-call cost/latency
  logging. Writes a `model_calls` row per call (stubbed until M1).
- `createLogger(env, { service, component })` — pino-backed structured
  logger. Every line carries `ts`, `level`, `service`, `component`,
  `msg`; child loggers propagate `household_id` and the OTel
  `trace_id`/`span_id`.
- `initTracing(env)` — OTel Node SDK with OTLP export. No-op when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.
- `runWorker(main, { shutdownTimeoutMs? })` + `onShutdown(fn)` — SIGTERM
  drain with LIFO handler order. Default 30s per spec.
- `withBudgetGuard(supabase, { household_id, task_class })` —
  per-household budget check; stubbed permissive until M1.
- Error classes: `NotYetImplementedError`, `StructuredOutputError`,
  `ModelCallError`, `QueueError`, `NangoError`. Each carries a `code`
  string for machine filtering.

## Per-household ordering

pgmq gives FIFO per queue, not per `ordering_key`. Per-household
ordering is enforced by the combination of:

1. visibility timeout: the message a worker is handling stays invisible
   while it works, so replicas can't race ahead in the same household.
2. client-side skip-if-household-in-flight inside a single worker
   process. Across instances we rely on the visibility timeout.

When the queue-depth-per-household metric shows this isn't enough, we
add a `jobs.in_flight_by_household` table as the authoritative gate.
The client exposes `options.visibilityTimeoutSec` today so callers can
already tune the knob.

## Not-yet-provisioned tables

Three call paths depend on M1 migrations that haven't landed yet:

| Call path               | Depends on                               | Behavior today                                      |
| ----------------------- | ---------------------------------------- | --------------------------------------------------- |
| `queue.deadLetter(...)` | `sync.dead_letter`                       | throws `NotYetImplementedError`                     |
| model-call cost logging | `app.model_calls`                        | warns once, then no-op                              |
| `withBudgetGuard(...)`  | `app.model_calls` + `household.settings` | warns once, returns `{ ok: true, tier: 'default' }` |

The interfaces are stable. When the M1 schema migration ships, each
call path starts doing the real thing with no code changes at the call
sites.

## Secrets

Never baked into code. The env schema enumerates what each worker
needs:

- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — always.
- `NANGO_HOST` + `NANGO_SECRET_KEY` — only for workers that will call
  `createNangoClient`.
- `OPENROUTER_API_KEY` — only for workers that will call
  `createModelClient`.

## Testing

Unit tests only in this package. Network is mocked via `vitest` (the
model-client test injects a fake `fetch`). Integration tests live in
worker-specific packages and run against the local Supabase stack.
