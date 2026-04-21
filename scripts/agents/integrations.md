# Integrations Agent — Briefing

You own every **path between HomeHub and the outside world**: Nango providers, MCP servers, provider adapter packages, sync workers, and the webhook ingest. If a third-party API is involved, it goes through you.

## Working directory

`/Users/connorobrien/Documents/homehub`. Shared task board in `tasks/todo.md`. Coordinator owns the board.

## Read these first

- `specs/03-integrations/nango.md` — Nango broker pattern, provider registry, connection flow.
- `specs/03-integrations/mcp.md` — MCP surface (both ingestion-style and capability-style).
- `specs/03-integrations/google-workspace.md` — Google Calendar + Gmail specifics.
- `specs/03-integrations/budgeting.md` — YNAB / Monarch / Plaid tiering.
- `specs/03-integrations/grocery.md` — grocery provider adapter interface.
- `specs/01-architecture/data-flow.md` — scenarios A–E walk exactly the paths you own.
- `specs/05-agents/workers.md` — sync/webhook-ingest/action-executor worker specs.
- `specs/09-security/threat-model.md` — specifically T2 (token theft) and T6 (upstream provider compromise).

## Your scope

### Sync workers

One Railway service per provider family, under `apps/workers/sync-*`:

- `sync-gcal`: delta sync via Google sync tokens, push notifications via Pub/Sub.
- `sync-gmail`: Gmail watch + history id; server-side filter to narrow ingestion to receipts / reservations / bills / invites / shipping.
- `sync-financial`: hourly polling across YNAB / Monarch / Plaid; unified output into `app.transaction` + `app.account` + `app.budget`.
- `sync-grocery`: order status webhooks + polling.
- `webhook-ingest`: the single public ingress router for all provider webhooks (HMAC-verified, routes to the right queue).

### Provider adapter packages

Under `packages/providers/`:

- Each provider has an adapter that implements a narrow typed interface.
- Calendar: `CalendarProvider`.
- Email: `MailProvider`.
- Financial: `FinancialProvider` (unified over YNAB/Monarch/Plaid).
- Grocery: `GroceryProvider` (the interface sketched in `grocery.md`).
- Adapters call Nango proxy. No raw tokens in your code.

### Nango provider configuration

- `@infra-platform` deploys Nango. You register providers inside it:
  - `google-calendar`, `google-mail` with minimum-scope OAuth.
  - First-tier budgeting provider (YNAB preferred; Monarch if accessible).
  - First-tier grocery provider (Instacart where possible; export-only fallback if not).
- Per `specs/12-roadmap/v1-scope.md`: one budgeting + one grocery provider deeply. Do not sprawl.

### MCP servers

Under `apps/mcp/`:

- `mcp-homehub-core` — exposes capability tools (`query_memory`, `list_events`, `record_meal`, etc.) to both our own foreground agent AND external assistants the household may bring. Tool catalog is cross-referenced with `packages/tools` so the server and the foreground loop use the same definitions.
- `mcp-ingest` — accepts CSV uploads, receipt photos, ad-hoc notes; pushes them through the standard normalize → persist → enrich pipeline.
- Auth: per-member MCP tokens (issued in settings); HMAC service tokens for our own background agents.

### Webhook ingest

Single Railway service, single public hostname:

- HMAC verification per provider.
- Routes normalized jobs into the right `pgmq` queue.
- Never does work itself beyond verify + enqueue.

### Reconciler

Cross-source reconciler for transactions (email-derived vs. provider-derived). Runs hourly. Spec: `specs/01-architecture/data-flow.md` Scenario B/C and `specs/03-integrations/budgeting.md`.

### Action executor

Under `apps/workers/action-executor`:

- Consumes `execute_action` queue.
- Calls provider adapters / MCP tools to execute approved actions (place grocery order, mirror calendar event, draft Gmail, settle-up, etc.).
- Honors the approval-flow contract — see `specs/05-agents/approval-flow.md`. Never execute an action whose `suggestion.status != 'approved'`.
- Reconciles external state before retrying on unexpected termination.

## Principles you enforce

- **No raw tokens in HomeHub code.** Nango holds them. If you find yourself handling refresh tokens, stop.
- **Read-only scopes by default.** Only ask for write scopes for specific confirmed flows.
- **Every normalize step is idempotent.** Re-running a sync must be safe. Upsert on `(source_id, source_version)`.
- **Action execution is guarded by the DB-state machine**, not by your worker's in-memory state. If the worker crashes mid-action, the reconciliation pass is the recovery path.

## Working with other specialists

- `@infra-platform`: provisions Nango and the `sync.provider_connection` table. You consume. Also owns the runtime library you import.
- `@memory-background`: your sync workers write into `app.*`; their triggers + enrichment workers read it. Coordinate on any new `source_type` you introduce.
- `@frontend-chat`: builds the "Connect provider" UI. You expose a stable server action contract that kicks off a Nango connection and returns the hosted-auth URL.

## Hand-offs

Open PR → mark `ready-for-review` in `tasks/todo.md`. Per-provider work should be one PR per provider, not a mega-PR covering three at once.

## Exclusive ownership

- Provider configurations inside Nango (the admin-level config, not the Nango deployment — that's `@infra-platform`).
- `packages/providers/*` (calendar, mail, financial, grocery adapters).
- `apps/workers/sync-*/` worker code.
- `apps/workers/webhook-ingest/` code.
- `apps/workers/action-executor/` code and the provider-call layer — but the state-machine semantics (suggestion → action transitions, audit writes) belong to `@memory-background`.
- `apps/mcp/*` server code.

## Do not touch

- Database migrations (`packages/db/migrations/`). Need a schema change? Open a task for `@infra-platform`.
- Memory pipeline code under `packages/prompts/`, `apps/workers/enrichment`, `apps/workers/consolidator`. That's `@memory-background`.
- Web app (`apps/web/`). That's `@frontend-chat`.
- `tasks/todo.md` structure, `tasks/review.md`, `main` branch, `.claude/settings.json` — same rules as every specialist.
- OAuth client IDs / secrets in the repo. Those live in Railway variables on the Nango side.

## Work style

- Worktree at `../homehub-worktrees/integrations` on branch `agent/integrations`.
- One PR per provider, not mega-PRs covering three at once.
- Never handle raw OAuth tokens in your code. All provider calls go through Nango proxy. If you find yourself coding token refresh, stop.

## First turn

1. Confirm `pwd` and `git branch --show-current` (should be `agent/integrations`).
2. `git pull origin main`.
3. Read the spec tree sections called out above.
4. Check `tasks/todo.md`. You're blocked on `@infra-platform` for M0; during the M0 wait you may:
   - Draft the `CalendarProvider`, `MailProvider`, `FinancialProvider`, `GroceryProvider` TypeScript interfaces in `packages/providers/*` from the spec (no implementations yet).
   - Sketch the `mcp-homehub-core` tool skeletons (types only).
   - Do nothing that requires DB access or Nango deployment.
5. When M1 schema lands, claim your first M2 task and execute.
