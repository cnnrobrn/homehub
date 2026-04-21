# Nango — Google Calendar provider runbook

How to register `google-calendar` as a Nango integration so HomeHub
workers can proxy Google Calendar v3 calls through it.

> The Nango 0.70.x self-hosted build does **not** ingest declarative
> `*.nango.yaml` provider configs at boot; provider registration happens
> in the admin UI. We keep this runbook as the source of truth. A YAML
> sibling is not shipped because the format is not wired up for our
> pinned version. If a later Nango release supports YAML provider
> configs, revisit.

Cross-references:

- Architecture: [`specs/03-integrations/nango.md`](../../../specs/03-integrations/nango.md)
- Scopes + sync model: [`specs/03-integrations/google-workspace.md`](../../../specs/03-integrations/google-workspace.md)
- Worker implementation: `apps/workers/sync-gcal`, `apps/workers/webhook-ingest`
- Provider adapter: `packages/providers/calendar`

## 1 — Create an OAuth client in Google Cloud

One-time, per environment (dev / staging / prod). Do this in Google
Cloud Console → APIs & Services.

1. **Create a project** if one does not exist (`homehub-dev`, `homehub-prod`).
2. **Enable APIs**:
   - Google Calendar API
   - (Optional) People API — not needed for M2-A; required for M2-B+ when
     enrichment resolves attendees.
3. **OAuth consent screen** → user type `External`. Add your personal
   email as a test user for dev. Fill the required fields (app name,
   support email, logo at 128×128 minimum, privacy policy URL). App
   publication + verification is only required before a public launch.
4. **Credentials** → Create Credentials → OAuth client ID:
   - Application type: **Web application**.
   - Name: `homehub-<env>-nango`.
   - Authorized JavaScript origins: the Nango server's public origin
     (local: `http://localhost:3003`).
   - Authorized redirect URIs: `<NANGO_SERVER_URL>/oauth/callback`. For
     our compose stack that's `http://localhost:3003/oauth/callback`.
     Production uses the Railway-assigned Nango URL.
5. Save the **Client ID** and **Client Secret**. These never commit —
   they ride in Railway environment variables (`NANGO_GOOGLE_CLIENT_ID`
   / `NANGO_GOOGLE_CLIENT_SECRET`) and are pasted into the Nango admin
   UI once per environment.

## 2 — Register the provider in Nango

Boot the local stack (`docker compose up -d` from `infra/nango/`) and
open the admin UI at `http://localhost:3003`.

1. Sign in with the `NANGO_DASHBOARD_USERNAME` / `NANGO_DASHBOARD_PASSWORD`
   from your `.env`.
2. **Integrations → New Integration**.
3. Search for **Google Calendar**. Select the built-in template.
4. Integration settings:
   - Unique Key: `google-calendar`
     _(This is the **Provider Config Key**. HomeHub code hard-codes it;
     do not change.)_
   - Client ID / Client Secret: paste from step 1.
   - **Scopes** (space-separated):
     ```
     https://www.googleapis.com/auth/calendar.readonly
     https://www.googleapis.com/auth/calendar.events
     ```
     Rationale:
     - `calendar.readonly` — list + read events across the user's
       calendars. Needed for all sync.
     - `calendar.events` — write scope. Reserved for post-M2 write-back
       ("add reservation to your calendar?" suggestions). If you want
       to ship read-only for M2-A only, drop `calendar.events` here and
       add it back when write-back lands. The runbook includes it so
       the re-consent dialog isn't triggered for existing users when we
       flip write-back on.
5. Save. The integration should show `active`.

## 3 — Wire HomeHub env

Workers read Nango via the runtime env variables validated by
`packages/worker-runtime/src/env.ts`:

```bash
NANGO_HOST=http://localhost:3003          # Railway-private URL in prod
NANGO_SECRET_KEY=<from Nango admin UI: Environment Settings → Secret Key>
```

The web app reads the same pair for `/api/integrations/connect` via
`apps/web/src/lib/env.ts`.

The webhook ingest service also needs the Nango webhook secret:

```bash
NANGO_WEBHOOK_SECRET=<from Nango admin UI: Environment Settings → Webhook Secret>
WEBHOOK_PUBLIC_URL=https://webhooks.homehub.example.com
```

Nango's webhook target should be set in the admin UI to
`${WEBHOOK_PUBLIC_URL}/webhooks/nango`.

## 4 — Canary verification

Confirm the integration works end-to-end before opening it to members:

1. From the web app: sign in as the owner, go to `/settings/connections`,
   click "Connect Google Calendar". You should be redirected to Nango's
   hosted-auth page, then Google's consent screen.
2. Approve. You should land back on `/settings/connections` (or the
   Nango success page in dev, depending on the `NANGO_CONNECT_UI_PORT`
   setting) and see the new `google-calendar` row with status `active`
   within a few seconds — the `connection.created` webhook flips it in.
3. Verify the full sync fired:
   ```sql
   select count(*) from app.event
   where provider = 'gcal' and household_id = '<your-household-uuid>';
   ```
4. Verify the channel subscription:
   ```sql
   select * from sync.cursor
   where kind = 'gcal.channel' and connection_id = '<connection-id>';
   ```
5. Make a test event in Google Calendar. Within ~1 minute you should
   see a new `app.event` row and an `audit.event` with
   `action='sync.gcal.delta.completed'`.

## 5 — Disconnect / revocation

- Member hits Disconnect in `/settings/connections` →
  `disconnectConnectionAction` → Nango `DELETE /connections/:id` →
  `sync.provider_connection.status='revoked'`.
- Nango also fires `connection.deleted` on member-side revocations from
  Google's end. The webhook ingest handles this by calling `unwatch` and
  flipping the row to revoked, same outcome.
- Historical `app.event` rows remain until the member separately
  requests deletion (see `specs/09-security/data-retention.md`).

## 6 — Operational notes

- **Sync token expiry.** Google's docs say sync tokens are valid for up
  to 7 days but can be invalidated earlier. The worker catches `410 Gone`
  and requeues as a full sync — no manual action required.
- **Watch channel expiry.** Google caps channel TTL at 7 days. We do
  not proactively refresh today; the hourly poll (tracked via
  `last_synced_at`) covers gaps. Automated re-watch lands in M2-B.
- **Rate limits.** Google returns 429 or 403 with
  `reason=quotaExceeded`. The worker nacks with the provider's
  `Retry-After`. Dashboards (M10) will alert on sustained 429s.
- **Minimum-scope re-consent.** If you tighten scopes, existing
  connections keep the broader grant until the member re-authorizes.
  Queue a notification rather than silently widening.
