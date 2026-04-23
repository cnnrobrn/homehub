---
name: ops
description: Read operator dashboards for system health. Use when the user asks about worker status, DLQ health, model usage, or operational metrics.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, ops]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
    required_for: all queries
  - name: HOMEHUB_SUPABASE_URL
    required_for: database access
  - name: HOMEHUB_SUPABASE_ANON_KEY
    required_for: PostgREST apikey header
  - name: HOMEHUB_SUPABASE_JWT
    required_for: household-scoped Authorization bearer
---

# Ops

See `_shared` for auth/scoping rules. **Owner-gated; read-only.** Do not execute DLQ replays or mutations.

## When to Use

- User asks about worker heartbeat status, stale workers, or sync health.
- User wants to check recent dead-letter queue entries or error patterns.
- User inquires about model API usage by day or LLM call metrics.

## Read: Worker Heartbeats

```bash
# Stale workers (last_seen_at > 5 min ago)
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: sync" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/worker_heartbeat?household_id=eq.$HOUSEHOLD_ID&last_seen_at=lt.$(date -u -d '5 minutes ago' +%FT%TZ)&order=last_seen_at.desc&limit=50"
```

Key columns: `worker_id`, `last_seen_at`, `status`, `queue_depth`.

## Read: Dead Letter Queue

```bash
# Recent DLQ entries
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: sync" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/dead_letter?household_id=eq.$HOUSEHOLD_ID&order=created_at.desc&limit=50"
```

Key columns: `id`, `event_type`, `error_reason`, `created_at`, `payload`.

## Read: Model Usage

```bash
# Daily model calls
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/model_calls?household_id=eq.$HOUSEHOLD_ID&order=created_at.desc&limit=100"
```

Key columns: `id`, `model`, `created_at`, `input_tokens`, `output_tokens`, `cost`.

## Do NOT Write

- No mutations to DLQ or worker state. For DLQ replays or worker resets, direct user to `/ops/dlq`.

## Pitfalls

- DLQ and worker data live in `sync` schema; use `Accept-Profile: sync`.
- Model usage lives in `app` schema; use default `Accept-Profile: app`.
- Heartbeat timestamps are `timestamptz`; interpret as UTC.
- Do not attempt to parse or replay DLQ payloads — this is owner-only.
