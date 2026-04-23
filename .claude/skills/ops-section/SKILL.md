---
name: ops-section
description: Populate data and add tabs/functionality in the Ops section (/ops). Use when the user wants to seed heartbeats/DLQ/model-usage rows, add a new ops tab (e.g. worker status, cost, exports), wire an admin action, or expose an ops tool to the Hermes chat agent.
---

# Ops section

Operator-facing dashboards: health, DLQ, model usage. Not member-visible
— gated behind owner-only access in the layout.

## Surface area

- Route root: `apps/web/src/app/(app)/ops/` with `layout.tsx`.
- Current tabs: DLQ (`dlq/`), Health (`health/`), Model usage
  (`model-usage/`). There is no ops SubNav file today — the layout
  currently renders its own nav; check `layout.tsx` before editing and
  extract into `OpsSubNav.tsx` if you're adding more than one tab.
- Data tables:
  - `sync.dead_letter` (DLQ) and `sync.provider_connection`,
    `sync.cursor` (migration `0009_sync_audit_model_calls.sql`).
  - `sync.worker_heartbeat`, `sync.household_export` (migration
    `0014_ops_heartbeat_exports.sql`).
  - `app.model_calls` (migration `0009_sync_audit_model_calls.sql`).
  - `audit.event` for operator-visible trails.
- DLQ admin helpers: `packages/dlq-admin`.
- Agent tools: none by default — ops is human-only today. If exposing
  to the agent, make it read-only (classification `read`).

## Populate data

1. **Local dev seed (SQL)** — append to `packages/db/supabase/seed.sql`.
   Useful seeds: a handful of `sync.worker_heartbeat` rows across worker
   names, one or two `sync.dead_letter` entries with realistic
   `payload` jsonb, `app.model_calls` rows with cost/tokens to exercise
   the usage dashboard. Ops seeds are cheap — make them varied so the
   filters have something to filter.
2. **Worker-driven** — the canonical path: heartbeats from
   `apps/workers/*` via `packages/worker-runtime`, DLQ from worker
   error paths, model calls from every `ModelClient.generate()` call.
   Run a local worker briefly if you want realistic volume.
3. **Admin writes** — DLQ replay / purge goes through
   `packages/dlq-admin`; never delete DLQ rows directly (audit trail).

## Add a tab

1. Create `apps/web/src/app/(app)/ops/<tab>/page.tsx`.
2. If this is the third-plus tab, extract `OpsSubNav.tsx` into
   `apps/web/src/components/ops/` (mirror `FinancialSubNav.tsx`) and
   render from `layout.tsx`.
3. Keep the owner-only gate — re-check membership role in the page,
   not only the layout, if the tab exposes raw PII.
4. Ops pages are almost always Server Components with client islands
   for interactivity (DLQ replay button, etc.).

## Gotchas

- Ops data grows fast; always paginate (DLQ especially). Use
  `.range()` with a cap, and order by `created_at desc`.
- `sync.dead_letter.payload` may contain secrets/tokens depending on
  worker — redact before rendering.
- `app.model_calls` cost is in fractional USD (numeric); format with
  fixed precision for the dashboard.
- Heartbeats use a `stale_after` threshold; compute "unhealthy" by
  comparing `last_seen_at` to the threshold, not a hard-coded window.
