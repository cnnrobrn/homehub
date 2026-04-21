# Observability

**Purpose.** How we see what's happening inside HomeHub in production.

**Scope.** Logs, metrics, traces, and dashboards.

## Principles

- **Structured logs or nothing.** Every log line is JSON with stable keys.
- **Correlate by household + request.** Every log in a request chain carries `household_id` and a `trace_id`.
- **Metrics first, logs second.** Use metrics for graphs and alerts; logs for root-cause.

## Logging

- Frontend (Vercel): default logs + Sentry on exceptions.
- Workers: stdout JSON → Railway log driver → log backend.
- Log backend: Axiom or Grafana Cloud (TBD in [`../01-architecture/stack.md`](../01-architecture/stack.md)).
- Required fields on every worker log: `level`, `ts`, `service`, `household_id`, `trace_id`, `job_id`, `message`, `fields`.

## Metrics

Minimum metrics per worker:

- Queue depth, claim rate, processing latency (p50/p95/p99).
- Job success / failure / DLQ rates.
- Model calls: count, tokens in/out, latency, cost.
- Per-household counters (same metrics, cardinality scoped) for high-touch households.

Application-level:

- Active households, active members.
- Suggestion approvals / rejections per category.
- Alert firing rate per category.
- Summary generation count.

## Tracing

OpenTelemetry across the pipeline:

- Provider webhook → sync worker → DB insert → enrichment → graph write → suggestion run.
- Spans carry `household_id`, `provider`, `entity_type`, `model`.
- Foreground requests (server actions) also traced; sampled.

## Alerting

Paging:

- Worker service unhealthy > 5 minutes.
- Queue age-of-oldest exceeds threshold (per queue).
- DLQ non-empty for > 15 minutes.
- Model cost anomaly (spike > 3× 24h baseline).

Non-paging (email/Slack to team):

- Elevated error rate on a specific provider.
- Household hitting model budget ceiling.

## Dashboards

- **Core Health** — worker status, queue depth, error rates.
- **Ingestion** — per-provider sync lag and failure rates.
- **Model** — cost, latency, cache-hit rate per task.
- **Per-household** (internal support) — a detail view pulling the household's recent errors, queue history, and recent summaries.

## Privacy-aware logging

- Never log raw emails, transaction memos with account numbers, or member PII beyond what's needed for debugging.
- A redaction pass inside the logging helper strips known PII shapes (email addresses → `<email>`, CC numbers → `<card>`, etc.).

## Dependencies

- [`../08-backend/workers.md`](../08-backend/workers.md)
- [`../09-security/threat-model.md`](../09-security/threat-model.md)
