# Stack

**Purpose.** Concrete technology choices, versions, and plan tiers.

**Scope.** What we commit to using. Not how to operate it.

## Frontend / Edge — Vercel

- **Framework:** Next.js (App Router), TypeScript, React Server Components by default.
- **Styling:** Tailwind CSS. Component primitives from shadcn/ui.
- **Data fetching:** Server Components for initial paint; `@supabase/ssr` for auth-aware reads; Supabase Realtime for live updates.
- **State:** Minimal client state. URL + server components first; Zustand only when truly needed (e.g., drag-reorder meal planner).
- **Forms:** React Hook Form + Zod for validation; server actions for mutations.
- **Plan:** Vercel Pro. Edge Functions enabled.

## Database / Auth / Realtime / Storage — Supabase

- **Postgres:** version 15+. Extensions required: `pgvector`, `pgmq`, `pg_cron`, `pg_trgm`, `uuid-ossp`.
- **Auth:** Supabase Auth. Providers enabled: Google, Email (magic link). Apple later.
- **Realtime:** Row-level subscriptions filtered by household id.
- **Storage:** For receipts, recipe photos, meal photos, attachments. Bucketed by household id with RLS.
- **Plan:** Supabase Pro at minimum; Team tier when we need point-in-time recovery.

## Compute — Railway

- **Workers:** Node.js (TypeScript) services. One service per worker class to isolate scaling and failure.
- **Nango:** Self-hosted via Nango's official Docker image. Pinned version.
- **MCP servers:** Node.js services. One Docker image per MCP server, one Railway service per deployment.
- **Scheduler:** Railway cron for outward-calling jobs; `pg_cron` inside Supabase for DB-internal jobs.
- **Plan:** Railway Pro. Horizontal scaling for sync and enrichment workers.

## Model Gateway — OpenRouter

- **Default model:** `moonshotai/kimi-k2` (referred to internally as Kimi 2.6).
- **Fallback:** routed alternate within OpenRouter on upstream failures.
- **Foreground model:** a larger model for interactive agent turns (chosen at runtime by model-routing spec).
- **Key storage:** OpenRouter API key lives in Railway secrets. Never exposed to the browser.

## Observability

- **Error reporting:** Sentry (frontend, workers).
- **Logs:** Structured JSON to stdout on Railway; Vercel logs for edge. Aggregated in a log backend (Grafana Cloud or Axiom — TBD).
- **Metrics:** OpenTelemetry from workers; Supabase metrics from the dashboard.
- **Tracing:** OpenTelemetry traces on the `provider → sync → enrichment → agent` path, because that's where latency matters.

## Local development

- **Monorepo:** `pnpm` workspaces.
- **Packages:** `apps/web` (Next.js), `apps/workers/*`, `apps/mcp/*`, `packages/db` (types, migrations), `packages/shared` (domain types, utilities).
- **Supabase local:** `supabase` CLI for a local Postgres + auth + realtime stack.
- **Nango local:** docker-compose alongside the Supabase stack.
- **Seed data:** a `pnpm seed` command that spins up a demo household with synthetic data.

## Version control & CI

- **Repo:** GitHub. Single repo (`homehub`).
- **CI:** GitHub Actions. Jobs: lint, typecheck, unit, integration, migration-lint.
- **Preview envs:** Vercel preview deploys per PR. Workers do not get preview envs; they run against staging Supabase + staging Nango.

## Dependencies

- [`system-overview.md`](./system-overview.md) — Where each of these components fits.
- [`environments.md`](./environments.md) — How these run in dev/staging/prod.

## Open questions

- Log backend: Axiom vs Grafana Cloud vs Better Stack. Pick based on total-cost-of-ownership for the data volume we expect.
- Do we need a dedicated queue (BullMQ on Redis) if `pgmq` is insufficient? Not until we prove a bottleneck.
