# System Overview

**Purpose.** The 10,000-foot view of how HomeHub's parts fit together.

**Scope.** Boundaries, responsibilities, and the happy-path data flow. Deep detail lives in sibling docs.

## Components

```
                   ┌───────────────────────────────┐
                   │         Vercel (Next.js)       │
                   │  - UI (control panel)          │
                   │  - Edge API routes             │
                   │  - Realtime subscriptions      │
                   └──────────────┬─────────────────┘
                                  │
                   ┌──────────────▼─────────────────┐
                   │           Supabase              │
                   │  - Postgres (system of record)  │
                   │  - Auth (user sessions)         │
                   │  - Realtime channels            │
                   │  - Storage (attachments)        │
                   │  - RLS (household isolation)    │
                   └──────▲───────┬──────────▲──────┘
                          │       │          │
           (LISTEN/NOTIFY)│       │(reads)   │(writes)
                          │       ▼          │
                   ┌──────┴───────────────────┴──────┐
                   │            Railway               │
                   │  - Sync workers                  │
                   │  - Enrichment workers            │
                   │  - Agent workers                 │
                   │  - Self-hosted Nango             │
                   │  - MCP servers                   │
                   │  - Scheduler (cron)              │
                   └──┬──────────────────────┬────────┘
                      │                      │
                ┌─────▼──────┐        ┌──────▼──────┐
                │ Providers  │        │ OpenRouter  │
                │ (Google,   │        │ (Kimi K2)   │
                │  banks,    │        └─────────────┘
                │  grocery)  │
                └────────────┘
```

## Responsibility boundaries

**Vercel (frontend + edge):**
- Renders the UI.
- Owns user-facing auth flows (via Supabase Auth SDK).
- Serves read-heavy API routes (cheap, cached, short-lived).
- Does not hold secrets for third-party providers.
- Does not run long jobs.

**Supabase (stateful core):**
- System of record for everything persistent: users, households, events, transactions, meals, memory nodes, memory edges, jobs.
- Enforces row-level security. No row leaves a household boundary without an explicit grant.
- Fires realtime events that the frontend subscribes to.

**Railway (compute plane):**
- Hosts all long-running processes: sync workers, enrichment workers, agent workers.
- Hosts self-hosted Nango and the MCP servers.
- Runs the scheduler that kicks off periodic jobs.
- Owns all outbound integrations. Vercel never calls a provider directly.

**Nango (integration broker):**
- Stores third-party OAuth tokens.
- Proxies provider API calls so HomeHub code never touches refresh tokens directly.
- Exposes a uniform interface for each provider.

**MCP servers:**
- Wrap sources Nango does not cover and expose HomeHub capabilities to models.
- Serve both background agents and any external Claude/ChatGPT client the household might point at their own HomeHub instance.

**OpenRouter:**
- Single model gateway. Default model is Kimi K2. Swappable.

## Happy-path data flow

1. Member authenticates via Supabase Auth (Google OAuth or email magic link).
2. Member connects a provider via Nango OAuth flow, initiated from the frontend.
3. Sync worker on Railway pulls data and writes it into Supabase tables scoped to the member.
4. Supabase `INSERT` fires a job into the enrichment queue (`pgmq` table).
5. Enrichment worker calls Kimi via OpenRouter, extracts metadata, writes nodes/edges into the memory graph (still Supabase Postgres).
6. Agent workers run on schedule and on triggers, producing summaries, alerts, and suggestions. Output rows are written to Supabase.
7. Frontend is subscribed to the member's household rows via Supabase realtime and updates live.
8. Member reviews a suggestion and taps approve. The frontend calls an API route which enqueues an action job. A worker executes the action through Nango or MCP and writes the outcome back.

## Non-goals for this architecture

- **Multi-region.** Single region in v1. Revisit when there's a non-US household.
- **Offline-first.** HomeHub is always-online. A cached last-state view in the browser is fine; full offline isn't a v1 goal.
- **Generic third-party API.** No public API for other products. MCP is the only external surface, and it's for the household's own agents.

## Dependencies

- [`stack.md`](./stack.md) — Exact versions and SaaS plans.
- [`data-flow.md`](./data-flow.md) — Detailed flow for each provider type.
- [`environments.md`](./environments.md) — dev/staging/prod.

## Open questions

- Do we run an in-Supabase queue (`pgmq`) or a separate Redis on Railway for job orchestration? Leaning `pgmq` — one fewer moving part, transactional with the data.
- Is the scheduler a Railway cron service or Supabase's `pg_cron`? Leaning `pg_cron` for jobs that only touch the DB; Railway cron for jobs that call external APIs.
