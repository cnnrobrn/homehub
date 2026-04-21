# Nango — YNAB provider runbook

How to register `ynab` as a Nango integration so HomeHub workers can
proxy YNAB v1 API calls through it.

> The Nango 0.70.x self-hosted build does **not** ingest declarative
> `*.nango.yaml` provider configs at boot; provider registration happens
> in the admin UI. This runbook is the source of truth.

Cross-references:

- Architecture: [`specs/03-integrations/nango.md`](../../../specs/03-integrations/nango.md)
- Budgeting model: [`specs/03-integrations/budgeting.md`](../../../specs/03-integrations/budgeting.md)
- Worker implementation: `apps/workers/sync-financial`, `apps/workers/webhook-ingest`
- Provider adapter: `packages/providers/financial`
- Reconciler: `apps/workers/reconciler`

## 1 — Create an OAuth client in YNAB

One-time, per environment (dev / staging / prod). YNAB's developer
portal is at <https://app.ynab.com/settings/developer>.

1. **Sign in as the household owner** (the OAuth app is registered on
   one YNAB account and reused for every HomeHub user — this is the
   Nango OAuth broker pattern).
2. **New Application**:
   - Name: `HomeHub <env>` (e.g. `HomeHub dev`).
   - Description: `Household control panel. Read-only transactions,
accounts, and budgets.`
   - Redirect URI: `<NANGO_SERVER_URL>/oauth/callback` — same pattern as
     the Google providers (local: `http://localhost:3003/oauth/callback`).
3. Save the **Client ID** and **Client Secret**. These never commit —
   they ride in Railway environment variables (`NANGO_YNAB_CLIENT_ID` /
   `NANGO_YNAB_CLIENT_SECRET`) and are pasted into the Nango admin UI
   once per environment.
4. **OAuth scopes**: YNAB exposes a single "read-only" scope today. The
   token has access to every budget the authorizing user can see (this
   is a YNAB limitation, not a HomeHub choice — filed as an upstream
   ask). HomeHub lets the member pick which budget to surface at
   connect time (budget-picker UI is a M5-C follow-up; today the sync
   worker defaults to the first / default budget).

## 2 — Register the provider in Nango

Boot the local stack (`docker compose up -d` from `infra/nango/`) and
open the admin UI at `http://localhost:3003`.

1. Sign in with the `NANGO_DASHBOARD_USERNAME` / `NANGO_DASHBOARD_PASSWORD`
   from your `.env`.
2. **Integrations → New Integration**.
3. Search for **YNAB**. Select the built-in template.
4. Integration settings:
   - Unique Key: `ynab`
     _(This is the **Provider Config Key**. HomeHub code hard-codes it
     via `YNAB_PROVIDER_KEY`; do not change.)_
   - Client ID / Client Secret: paste from step 1.
   - **Scopes**: leave the default `read-only` scope (YNAB's only
     scope today). No space-separated list is needed.
5. Save. The integration should show `active`.

## 3 — Wire HomeHub env

Workers read Nango via the runtime env variables validated by
`packages/worker-runtime/src/env.ts`:

```bash
NANGO_HOST=http://localhost:3003          # Railway-private URL in prod
NANGO_SECRET_KEY=<from Nango admin UI: Environment Settings → Secret Key>
```

The web app reads the same pair for `/api/integrations/connect?provider=ynab`
via `apps/web/src/lib/env.ts`.

The webhook ingest service and the sync-financial worker read:

```bash
NANGO_WEBHOOK_SECRET=<from Nango admin UI: Environment Settings → Webhook Secret>
WEBHOOK_PUBLIC_URL=https://webhooks.homehub.example.com

# Optional. Defaults to true. Flip to `false` to run the worker against
# YNAB without writing to app.transaction / app.account / app.budget.
HOMEHUB_FINANCIAL_INGESTION_ENABLED=true
```

Nango's webhook target should be set in the admin UI to
`${WEBHOOK_PUBLIC_URL}/webhooks/nango`.

## 4 — Canary verification

Confirm the integration works end-to-end before opening it to members:

1. From the web app: sign in as the owner, go to `/settings/connections`,
   click "Connect YNAB". You should be redirected to Nango's hosted-auth
   page, then YNAB's consent screen.
2. Approve. You should land back on `/settings/connections` and see the
   new `ynab` row with status `active` within a few seconds — the
   `connection.created` webhook flips it in.
3. Verify the full sync fired:
   ```sql
   select count(*) from app.transaction
   where source = 'ynab' and household_id = '<your-household-uuid>';
   ```
4. Verify the account snapshot:
   ```sql
   select id, name, kind, balance_cents, currency, last_synced_at
   from app.account
   where provider = 'ynab' and household_id = '<your-household-uuid>';
   ```
5. Verify the budget cursor:
   ```sql
   select * from sync.cursor
   where kind = 'ynab.knowledge' and connection_id = '<connection-id>';
   ```
6. Make a test transaction in YNAB. Within the hourly poll cycle you
   should see a new `app.transaction` row and an `audit.event` with
   `action='sync.ynab.delta.completed'`.

## 5 — Disconnect / revocation

- Member hits Disconnect in `/settings/connections` →
  `disconnectConnectionAction` → Nango `DELETE /connections/:id` →
  `sync.provider_connection.status='revoked'`.
- Nango also fires `connection.deleted` on member-side revocations from
  YNAB's end. The webhook ingest handles this by flipping the row to
  revoked and clearing cursors, same outcome.
- Historical `app.transaction` / `app.account` rows remain until the
  member separately requests deletion (see
  `specs/09-security/data-retention.md`).

## 6 — Operational notes

- **Cursor expiry.** YNAB returns `409 Conflict` with
  `id = 'knowledge_out_of_date'` when the stored
  `last_knowledge_of_server` is too old. The worker catches this as
  `CursorExpiredError`, clears the cursor, and requeues a full sync.
- **Rate limits.** YNAB's published limit is 200 requests per hour per
  access token. The worker nacks with a 5-minute retry (YNAB does not
  publish a `Retry-After` header).
- **No push webhooks from YNAB.** Delta sync is cron-driven (hourly). A
  Railway cron trigger invokes `apps/workers/sync-financial` with the
  `cron` script (`pnpm cron`), which enqueues `sync_delta:ynab` for
  every active connection.
- **Milliunit conversion.** YNAB amounts are in milliunits (1 unit =
  1000 milliunits). The adapter divides by 10 to produce cents at the
  boundary. No multi-currency support in M5-A.
- **Budget selection.** YNAB users with multiple budgets see only their
  default / first budget in HomeHub today. Budget-picker UI is a M5-C
  follow-up — track via `tasks/todo.md`.
- **Minimum-scope re-consent.** YNAB offers only one scope today, so
  there is nothing to tighten. If YNAB adds a finer-grained scope list,
  widen only what's strictly required.
