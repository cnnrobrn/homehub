# Runbook — DLQ replay

**Trigger:** alert "DLQ non-empty for > 15 minutes" (per the paging
rules in `specs/10-operations/observability.md`).

## 1. Identify the scope

From an owner account, open `/ops/dlq`. Entries are per-household and
include queue + short error summary.

For a cross-household view (operator-only), use the CLI from a Railway
shell with service-role creds:

```bash
pnpm --filter @homehub/dlq-admin dlq list --limit 50
pnpm --filter @homehub/dlq-admin dlq list --queue enrich_email --limit 50
```

## 2. Diagnose the cause

- Check the worker's Railway logs in the same window. `household_id` +
  `trace_id` in the JSON log correlate back to the failing message.
- Inspect the stored `payload` JSON — operators can copy it from the
  UI or via `select payload from sync.dead_letter where id = ?`.
- Common causes:
  - Upstream provider 5xx (transient): safe to replay.
  - Schema validation failure: the producer shipped a bad envelope;
    **do not replay** — fix the producer first.
  - Downstream dependency outage (OpenRouter, Supabase storage):
    replay after the dep is healthy.

## 3. Replay

Single entry (UI):

- Click **Replay** on the row in `/ops/dlq`.

Batch (CLI):

```bash
pnpm --filter @homehub/dlq-admin dlq replay <id>
```

The primitive re-validates the stored envelope before re-queuing. If
the payload is malformed you get a `payload is not a valid MessageEnvelope`
response — don't blindly try again; go fix the producer.

## 4. Clean up

- If a replay succeeded, **purge** the DLQ row so the next alert is
  signal, not noise.
- If the replay surfaces the same error again, investigate before the
  next attempt — looping replays burn worker capacity and can DoS an
  upstream that's already under stress.

## 5. Post-incident

- Log the root cause in the incident timeline
  ([`runbooks/incident-response.md`](./incident-response.md)).
- If the cause was producer-side schema drift, add a contract test.
- If recurring, consider a dedicated handler (e.g. exponential backoff
  in the worker before it DLQs) rather than more manual replays.
