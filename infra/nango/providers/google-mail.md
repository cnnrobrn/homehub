# Nango — Google Mail (Gmail) provider runbook

How to register `google-mail` as a Nango integration so HomeHub workers
can proxy Gmail v1 calls through it. Sibling to
[`google-calendar.md`](./google-calendar.md); same conventions apply —
read that first.

Cross-references:

- Architecture: [`specs/03-integrations/nango.md`](../../../specs/03-integrations/nango.md)
- Scopes + sync model: [`specs/03-integrations/google-workspace.md`](../../../specs/03-integrations/google-workspace.md)
- Privacy + retention: [`specs/09-security/data-retention.md`](../../../specs/09-security/data-retention.md)
- Worker implementation: `apps/workers/sync-gmail`, `apps/workers/webhook-ingest`
- Provider adapter: `packages/providers/email`

## 1 — OAuth client in Google Cloud

Reuse the `homehub-<env>-nango` OAuth client from the Google Calendar
runbook — it's the same Nango instance. One-time per environment:

1. **Enable APIs** (in addition to whatever the calendar runbook
   enabled):
   - Gmail API.
   - Cloud Pub/Sub API (for Gmail push notifications; see §4).
2. **OAuth consent screen** — no new fields; Gmail scopes reuse the
   same screen.
3. **Credentials** — the Web application OAuth client already exists.
   No change needed.

## 2 — Register the provider in Nango

Admin UI at `http://localhost:3003` (local) or the Railway-assigned URL
(prod).

1. **Integrations → New Integration** → search "Google Mail" / "Gmail".
   Select the built-in template.
2. Integration settings:
   - Unique Key: `google-mail`
     _(HomeHub hard-codes this. Do not change.)_
   - Client ID / Client Secret: same values as `google-calendar`.
   - **Scopes** (space-separated):
     ```
     https://www.googleapis.com/auth/gmail.readonly
     https://www.googleapis.com/auth/gmail.labels
     https://www.googleapis.com/auth/gmail.modify
     ```
     Rationale:
     - `gmail.readonly` — list + read messages and attachments.
     - `gmail.labels` — create the `HomeHub/Ingested` label.
     - `gmail.modify` — apply that label to ingested messages. We do
       not request send or delete scopes.
3. Save. The integration should show `active`.

## 3 — Wire HomeHub env

Nango transport variables: reuse `NANGO_HOST` / `NANGO_SECRET_KEY` from
the calendar setup.

New variables for the Gmail flow (defined on the `webhook-ingest` and
`sync-gmail` services):

```bash
# webhook-ingest
NANGO_GMAIL_PUBSUB_TOPIC=projects/<gcp-project>/topics/<topic>
HOMEHUB_GMAIL_WEBHOOK_TOKEN=<random 32 bytes hex — embedded in Pub/Sub push URL>
# Optional — set when you wire a JWT-audience check on the push endpoint:
HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE=<audience string configured on the push subscription>

# sync-gmail
HOMEHUB_EMAIL_INGESTION_ENABLED=false   # flip to true once migration 0012 has shipped
```

## 4 — Pub/Sub topic + push subscription

Gmail push notifications go to Google Cloud Pub/Sub. HomeHub consumes
them by registering a **push subscription** that posts to
`${WEBHOOK_PUBLIC_URL}/webhooks/google-mail/pubsub`.

1. In Google Cloud Console → Pub/Sub → **Topics** → create a topic like
   `gmail-push`. Note the full name
   `projects/<gcp-project>/topics/gmail-push` — this is
   `NANGO_GMAIL_PUBSUB_TOPIC`.
2. Grant Gmail push: on the topic → **Add Principal** →
   `gmail-api-push@system.gserviceaccount.com` with role
   `Pub/Sub Publisher`.
3. Create a **push subscription** on that topic with endpoint URL:
   ```
   https://<webhook-ingest-host>/webhooks/google-mail/pubsub?token=<HOMEHUB_GMAIL_WEBHOOK_TOKEN>
   ```
   The `token` query gates the webhook; the handler rejects requests
   without it when `HOMEHUB_GMAIL_WEBHOOK_TOKEN` is set. When you also
   configure a JWT audience on the subscription, set
   `HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE` so the handler requires an
   `Authorization: Bearer <jwt>` header as well.
4. The `users.watch` call that the webhook-ingest service makes when a
   connection lands sets `topicName` to the value from step 1. Gmail
   starts posting history notifications within a few minutes.

## 5 — Canary verification

1. Ensure `HOMEHUB_EMAIL_INGESTION_ENABLED=false` during the
   migration-pending window. The worker will run end-to-end but skip
   writes.
2. From the web app: `/settings/connections` → "Connect Gmail". The
   privacy-preview dialog opens; select categories and click "Continue
   to Google".
3. Approve the Google OAuth consent. You should land back on
   `/settings/connections` with a `gmail` row in status `active`.
4. Verify the webhook seeded the watch:
   ```sql
   select kind, value from sync.cursor
   where kind in ('gmail.watch', 'gmail.history_id')
     and connection_id = '<connection-id>';
   ```
5. Verify the full-sync message landed on the queue (should drain
   quickly):
   ```sql
   select pgmq.queue_length('sync_full:gmail');
   ```
6. Tail the sync-gmail logs — you should see `sync starting`, then
   `email ingestion disabled; skipping persist` per batch, then
   `sync completed`.
7. After migration 0012 lands and the flag flips:
   - Send yourself a test receipt/tracking email.
   - Within ~1 minute you should see a new `app.email` row and an
     `audit.event` with `action='sync.gmail.delta.completed'`.
   - In Gmail, the message picks up the `HomeHub/Ingested` label.

## 6 — Disconnect / revocation

- Member hits Disconnect → `disconnectConnectionAction` →
  Nango `DELETE /connections/:id` →
  `sync.provider_connection.status='revoked'`.
- `connection.deleted` webhook additionally calls `users.stop` to end
  the Gmail watch subscription and wipes `sync.cursor` rows for the
  connection.
- Historical `app.email` rows remain until the member requests deletion
  (see `specs/09-security/data-retention.md`).

## 7 — Operational notes

- **History id expiry.** Gmail invalidates history ids after ~7 days
  or at provider discretion. The sync worker catches `404` on
  `history.list` and requeues as a full sync — no manual action.
- **Watch renewal.** `users.watch` expires after 7 days. For v1 we
  re-watch on `connection.created` only; renewal automation lands in a
  follow-up (tracked in the M4-A report).
- **Rate limits.** Gmail returns 429 or 403 with
  `reason=rateLimitExceeded`. The worker nacks with the provider's
  `Retry-After`.
- **Body retention.** We only persist the ~2KB preview at sync time
  per `specs/09-security/data-retention.md`. Full bodies are fetched
  on demand by M4-B's extraction worker.
- **Feature flag.** `HOMEHUB_EMAIL_INGESTION_ENABLED` gates persistence
  until the schema ships. The worker still runs + acks + logs so the
  Nango + Pub/Sub paths can be exercised.
