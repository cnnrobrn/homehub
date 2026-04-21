# Nango — production deployment runbook

This is the "what do I do" document for operating HomeHub's production
Nango instance on Railway. For local dev see [`../README.md`](../README.md).
For architecture see [`../../../specs/03-integrations/nango.md`](../../../specs/03-integrations/nango.md).

> **Audience.** The human operator with Railway admin rights. A staff
> engineer should be able to follow this cold during an incident.

---

## 1. Provisioning from scratch

You do this once per long-lived environment (staging and production).

### 1.1 Create the Railway project and link it

```bash
cd infra/nango
railway login
railway link               # pick or create the "homehub-nango" project
railway environment        # confirm you're on the right env (staging vs production)
```

### 1.2 Provision the managed Postgres add-on

Railway can't describe managed plugins in `railway.toml`, so this is
manual:

```bash
railway add --plugin postgresql --name nango-db
```

Railway now exposes `DATABASE_URL`, `PGHOST`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE`, and `PGPORT` as variables on the project.

### 1.3 Provision the managed Redis add-on

```bash
railway add --plugin redis --name nango-redis
```

Exposes `REDIS_URL`.

### 1.4 Provision the `nango-server` service

`railway up` (or let the UI pick up `railway.toml`) creates the service
pinned to `nangohq/nango-server:hosted-0.70.1`.

### 1.5 Set variables

Every variable listed in the commented block of `railway.toml`. Use
Railway's UI or:

```bash
railway variables set NANGO_ENCRYPTION_KEY="$(openssl rand -base64 32)"
railway variables set NANGO_DB_HOST='$${{nango-db.PGHOST}}'
railway variables set NANGO_DB_PORT='$${{nango-db.PGPORT}}'
railway variables set NANGO_DB_USER='$${{nango-db.PGUSER}}'
railway variables set NANGO_DB_PASSWORD='$${{nango-db.PGPASSWORD}}'
railway variables set NANGO_DB_NAME='$${{nango-db.PGDATABASE}}'
railway variables set NANGO_DB_SSL=true
railway variables set RECORDS_DATABASE_URL='$${{nango-db.DATABASE_URL}}'
railway variables set NANGO_REDIS_URL='$${{nango-redis.REDIS_URL}}'
railway variables set SERVER_PORT=3003
railway variables set NANGO_SERVER_URL=https://nango.railway.internal
railway variables set NANGO_PUBLIC_SERVER_URL=https://nango.homehub.app
railway variables set FLAG_AUTH_ENABLED=true
railway variables set FLAG_SERVE_CONNECT_UI=true
railway variables set NANGO_CONNECT_UI_PORT=3009
railway variables set LOG_LEVEL=info
railway variables set NANGO_TELEMETRY=false
railway variables set CSP_REPORT_ONLY=false
```

> **The `$${{...}}` syntax** is Railway's cross-service variable
> reference — literal dollar-signs in the shell, Railway resolves them
> at deploy time.

### 1.6 Bind the custom domain

In the Railway UI → `nango-server` → Settings → Networking:

- Add custom domain `nango.homehub.app` (or the staging equivalent).
- Set the target port to **3003** (the API + Connect UI are served on
  the same container but different ports — we expose only the API; the
  Connect UI is reached through the same hostname via an internal
  rewrite Nango does itself).
- Confirm the TLS cert provisions.

### 1.7 Confirm workers can reach Nango

From one of the worker services (`apps/workers/*`):

```bash
railway variables set NANGO_HOST=https://nango.railway.internal
railway variables set NANGO_SECRET_KEY=<copy from Nango admin UI>
```

The `NANGO_SECRET_KEY` comes from the Nango dashboard under **Environment
Settings → Secret Key** _per environment_ (separate staging/prod keys).

---

## 2. Backups

Two layers, per `specs/03-integrations/nango.md`:

### 2.1 Railway managed nightly backups

Railway's Postgres plugin takes a nightly automated backup with a
7-day retention window. No config — it's on by default. Verify:
Railway UI → `nango-db` → Backups.

### 2.2 Weekly logical dump into Supabase Storage

We do NOT trust a single backup provider. A weekly cron in Railway
dumps the Nango DB and uploads it to a Supabase Storage bucket that
HomeHub owns.

Setup (one-time, per environment):

1. Create a Supabase Storage bucket `nango-backups` with public access
   disabled. Set a 90-day lifecycle policy.
2. Generate a service-role-scoped token with write access only to that
   bucket. Store it as `SUPABASE_BACKUP_TOKEN` in Railway on the
   `nango-backup-cron` service.
3. Deploy `apps/workers/nango-backup-cron` (owned by `@infra-platform`
   — scaffolding lands as part of M0-E) with a schedule of `0 3 * * 0`
   (weekly Sunday 03:00 UTC).

The cron runs:

```bash
pg_dump "$DATABASE_URL" --no-owner --no-acl --format=custom \
  | gzip \
  | curl -fsSL -X POST \
      -H "Authorization: Bearer $SUPABASE_BACKUP_TOKEN" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @- \
      "https://<project>.supabase.co/storage/v1/object/nango-backups/nango-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

### 2.3 Restoring a backup

Never restore directly into production without a drill. Procedure:

1. Download the dump from Supabase Storage or Railway Backups.
2. Spin up a throwaway Postgres (local docker or a scratch Railway
   project): `pg_restore --no-owner --no-acl --dbname=<scratch> dump.sql.gz`.
3. Inspect that the row counts and the most recent `connections` row
   look right.
4. Only then promote: stop `nango-server`, `pg_restore` into the live
   DB in `--clean` mode, restart `nango-server`.
5. Bump every provider connection's integration client secret if you
   suspect the dump had drifted tokens.

---

## 3. Rotating the encryption key

The `NANGO_ENCRYPTION_KEY` encrypts every stored credential. Rotating
it is a scheduled-maintenance operation, not an incident response.

1. Announce a maintenance window. Expect 5-10 minutes of Nango
   unavailability; workers will queue.
2. Drain write traffic: scale `webhook-ingest` and sync workers to 0.
3. Take a backup (see §2.2).
4. In Nango admin UI → Settings → Encryption Key → Rotate. Enter the
   current key (to decrypt) and the new key (to re-encrypt). Nango
   re-encrypts every row in place.
5. Update `NANGO_ENCRYPTION_KEY` in Railway variables to the new value.
6. Redeploy `nango-server`. Verify `/health` green.
7. Scale workers back up. Watch for `connection_invalid` errors — if
   you see any, the rotation transcription was wrong; restore from §2.3.

If Nango's admin UI does not expose a rotation flow on the pinned
version, you cannot hot-rotate — the procedure becomes: take a fresh
key, nuke the connections table, ask members to reconnect. Prefer the
hot path; fall back only if explicitly necessary.

---

## 4. Upgrading

The canonical upgrade procedure is short and lives in
[`../README.md`](../README.md#upgrading-nango). Production promotion
specifically:

1. Staging has been running the new tag for ≥ 24 hours with clean logs
   and no connection errors.
2. A canary smoke has exercised at least one provider per auth type
   (OAuth 2, Plaid Link, API key) end-to-end.
3. Open a production deploy PR that flips `image = "nangohq/nango-server:hosted-<new>"`
   in `railway.toml` and the same tag in `docker-compose.yml`.
4. Merge to `main` triggers Railway's manual-promote flow.
5. Watch `nango-server` logs for 10 minutes post-promote; abort by
   reverting the PR if `connection_invalid` rate spikes.

---

## 5. Incident runbook — "Nango is down"

### 5.1 What's the user-facing impact?

- Members cannot connect new providers (`/api/integrations/connect`
  returns 5xx).
- Existing connections continue to be valid for the refresh-token
  window — typically 1 hour for OAuth 2, then reauth fails.
- Sync workers surface errors: `NangoError: nango.proxy ... failed`.
  They should retry with backoff (see `packages/worker-runtime/src/queue`).
  No data is lost; jobs accumulate on the queue.
- Webhook deliveries from Gmail / Calendar hit `webhook-ingest`, which
  in turn queues for later replay — the webhook fan-in is Nango-free,
  so ingestion does NOT stop.

### 5.2 Triage (first 5 minutes)

1. Railway UI → `nango-server` → Metrics. CPU pegged at 100%? OOM?
   Healthcheck red?
2. `railway logs -s nango-server --tail 200`. Look for:
   - `ECONNREFUSED` to Postgres → `nango-db` is down.
   - `EPIPE` / `socket hang up` to Redis → `nango-redis` is down.
   - `Invalid encryption key` → `NANGO_ENCRYPTION_KEY` rotated without
     the admin-side rotation; restore the old key from the secret store.
3. `curl -fsS https://nango.homehub.app/health` — is the public edge
   up? Cloudflare / Railway proxy layer? DNS?

### 5.3 Common fixes

| Symptom                                                | Cause                                                                                                      | Fix                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Healthcheck red, logs say `ECONNREFUSED nango-db:5432` | Postgres plugin scaled down or failing over                                                                | Railway UI → `nango-db` → restart. If the plugin is in a bad state, restore from §2.3.                                          |
| Logs say `Invalid encryption key`                      | Someone rotated the key in Railway but not in the admin UI (or vice versa)                                 | Restore the previous `NANGO_ENCRYPTION_KEY` from secret history. Never just generate a new one — you'll brick every connection. |
| Healthcheck green, workers still failing               | Stale `NANGO_SECRET_KEY` in the worker. Nango regenerates the secret key if the environment was recreated. | Copy the current key from Nango admin UI → Environment Settings, set on every worker service, redeploy.                         |
| Connect UI loads but OAuth callback 4xx                | Custom-domain cert or redirect URI drift. Provider's OAuth client has the wrong redirect URI whitelisted.  | Check provider client config; confirm `NANGO_PUBLIC_SERVER_URL` matches the domain the provider redirects to.                   |

### 5.4 Degraded-mode expectations

If Nango will be down for >1 hour:

- Post a banner on the web app: "Integrations are temporarily
  unavailable. Connected accounts will resume syncing once service is
  restored."
- Queue depths on `jobs.sync_incremental` will grow; this is fine up to
  ~24 hours. Beyond that, partition the queues to shed old work if
  lag becomes user-visible.
- Do NOT start handing out new OAuth tokens manually. Every path goes
  through Nango or through a full disconnect+reconnect once Nango is
  back.

### 5.5 Post-incident

1. Capture the timeline in a post-mortem (date, detection, root cause,
   fix, blast radius).
2. If the root cause was config drift (key rotation mismatch, stale
   secret key), add a pre-deploy check.
3. If the root cause was upstream Nango, note the version in the
   post-mortem and hold off on future upgrades to that branch.

---

## Related

- [`../README.md`](../README.md) — local dev.
- [`../railway.toml`](../railway.toml) — declarative service spec.
- [`../docker-compose.yml`](../docker-compose.yml) — pinned image.
- [`specs/03-integrations/nango.md`](../../../specs/03-integrations/nango.md) — architecture + provider list.
- [`specs/10-operations/observability.md`](../../../specs/10-operations/observability.md) — how Nango's logs reach our pipeline.
