# Nango — local deployment

HomeHub's OAuth broker. Every call to a third-party provider that needs
delegated credentials goes through a self-hosted Nango instance. See
[`specs/03-integrations/nango.md`](../../specs/03-integrations/nango.md)
for the architectural "why"; this file is the operational "how".

For the production (Railway) runbook see [`docs/production-deploy.md`](./docs/production-deploy.md).

## What's in here

| File                        | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `docker-compose.yml`        | Local dev stack: Nango server + Postgres + Redis, pinned versions.     |
| `.env.example`              | Env template. Copy to `.env` and fill `NANGO_ENCRYPTION_KEY`.          |
| `railway.toml`              | Declarative Railway config for production — human runs `railway link`. |
| `docs/production-deploy.md` | Production provisioning, backups, upgrades, incident runbook.          |

## Prerequisites

- Docker Desktop 4.37.1 or later (Nango's requirement).
- Docker Compose v2 (`docker compose`, not `docker-compose`).
- `openssl` for generating the encryption key.

## Quickstart

From `infra/nango/`:

```bash
cp .env.example .env

# Generate the encryption key. Do this ONCE and keep it. Losing it
# means losing every stored provider credential.
printf 'NANGO_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" >> .env
# then edit .env and remove the placeholder empty line for NANGO_ENCRYPTION_KEY
# (or just set it by hand).

docker compose up -d
docker compose logs -f nango-server
```

Wait for `nango-server` to print a line like `Server listening on port 3003`.
The stack is healthy when `docker compose ps` shows all three services as
`healthy`.

Admin UI: http://localhost:3003 (basic auth — default `admin`/`change-me-local-only`
unless you edited `.env`).

Nango Connect UI (hosted OAuth page members see): http://localhost:3009.

### Verifying

```bash
curl -fsS http://localhost:3003/health
# -> { "status": "ok" } (or similar)
```

## How HomeHub workers reach Nango locally

Workers read these from their own env (set in the worker's `.env.local`,
not in `infra/nango/.env`):

```bash
NANGO_HOST=http://localhost:3003
NANGO_SECRET_KEY=<copy from Nango admin UI after registering your first provider>
```

The schema lives in [`packages/worker-runtime/src/env.ts`](../../packages/worker-runtime/src/env.ts).
Obtaining the secret key: in the Nango admin UI, go to **Environment
Settings → Secret Key**. It's one key per environment, not per provider.

## Registering providers

Provider registration (google-calendar, google-mail, ynab, instacart, ...)
is owned by `@integrations` — not this package. Once the stack is up:

1. Open http://localhost:3003.
2. Sign in with the basic-auth creds from `.env`.
3. Go to **Integrations** and follow `@integrations`' provider-specific
   notes for OAuth client IDs/secrets and scopes.

The canonical provider list is in [`specs/03-integrations/nango.md`](../../specs/03-integrations/nango.md#provider-registry).
This README does NOT document per-provider OAuth client creation —
that's `@integrations`'s lane and lives in their notes.

## Upgrading Nango

The version is pinned in `docker-compose.yml` at the `image:` line for
`nango-server`. **Never** bump to `latest` or to a bare `hosted` tag —
always pin the exact `hosted-<semver>` build.

Upgrade procedure (matches `specs/03-integrations/nango.md`):

1. Pick the new tag from https://hub.docker.com/r/nangohq/nango-server/tags.
   Prefer a `hosted-<semver>` tag, not a raw commit hash.
2. Open a PR that bumps both `docker-compose.yml` and `railway.toml` in
   the same commit. Describe the Nango changelog delta in the PR body.
3. Staging deploys automatically on merge. Run a connection smoke per
   provider in the staging Nango admin UI.
4. Only then promote to production (see `docs/production-deploy.md`).

## Lifecycle

```bash
docker compose up -d          # boot
docker compose logs -f        # follow all logs
docker compose ps             # show health
docker compose restart nango-server   # apply env / code-level tweaks
docker compose down           # stop everything, preserve volumes (safe)
```

### ⚠️ Destructive

```bash
docker compose down -v
```

Deletes the named volumes (`homehub-nango-db-data`, `homehub-nango-redis-data`).
**Every provider connection, OAuth token, and encryption-protected secret
stored in Nango will be wiped.** Only run this against a local dev stack.
NEVER run this against a production Nango instance — go read
[`docs/production-deploy.md`](./docs/production-deploy.md) first.

## Backups

Local dev uses throwaway named volumes — no backups. Production backups
(Railway nightly + weekly logical dump into Supabase Storage) are
documented in [`docs/production-deploy.md`](./docs/production-deploy.md).

## Troubleshooting

- **`nango-server` exits immediately with "encryption key not set"**: you
  forgot to put a real value in `NANGO_ENCRYPTION_KEY`. Compose is wired
  to fail loud (`${NANGO_ENCRYPTION_KEY:?...}`) so this is caught early.
- **Healthcheck never turns green**: check `docker compose logs nango-server`
  for Postgres connection errors. The most common cause is stale volume
  state from a previous Nango version — `docker compose down -v` on a
  clean dev machine is safe, just not on shared state.
- **Port 3003 / 3009 already in use**: another compose project or a
  previously-orphaned Nango container. `docker ps | grep 3003` to find
  and stop it.
- **Apple Silicon performance**: the `nangohq/nango-server` image is
  linux/amd64-only; Docker Desktop runs it under emulation. Slow but
  functional for local dev. Production on Railway is native x86_64.

## Related

- [`specs/03-integrations/nango.md`](../../specs/03-integrations/nango.md) — architecture + provider list.
- [`packages/worker-runtime/src/nango/client.ts`](../../packages/worker-runtime/src/nango/client.ts) — how HomeHub code talks to Nango.
- Nango docs: https://nango.dev/docs/host/self-host/self-hosting-instructions
