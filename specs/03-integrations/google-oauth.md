# Google OAuth (native)

**Purpose.** Native OAuth broker for Google APIs (Gmail + Calendar) that replaces Nango on the Google path. Owned and operated by HomeHub — no external broker in the loop.

**Scope.** Why Google is special-cased, how the flow runs, where tokens live, and the boundary with the remaining Nango-managed providers (YNAB, Instacart).

## Why Google only

Google is the highest-volume integration and the UX/latency/reliability cost of running its OAuth through a hosted broker was outsized. Native OAuth buys us:

- A redirect URL we control, so no "stranded on success page" UX.
- No webhook-mediated handshake for connection creation (the callback *is* the creation event).
- One less always-on service in the critical path.

Other providers (YNAB today, more later) stay on Nango. See [`nango.md`](./nango.md).

## Deployment

- OAuth client registered in a HomeHub-owned GCP project.
- Scopes: `calendar.events`, `gmail.readonly` + `gmail.modify` (gated per `email_category`), plus `openid email` to get a verified `sub` and address from the id_token.
- Redirect URI: `${NEXT_PUBLIC_APP_URL}/api/oauth/google/callback`, registered with the OAuth client. Both dev (`http://localhost:3000/...`) and prod are registered.
- Client id / secret live in `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` on Vercel (web) and Railway (workers).

## Token custody

Refresh tokens are persisted in `sync.google_connection` encrypted with AES-256-GCM. The master key is a 32-byte base64 value in `GOOGLE_TOKEN_ENCRYPTION_KEY_V{N}`. Rows carry `key_version` so rotation is a background re-encrypt job, not a schema change.

Access tokens are also cached (encrypted) so concurrent workers don't all hammer `/token`. They're refreshed lazily inside `GoogleHttpClient.proxy` when within 60s of expiry or on a 401.

The ciphertext columns are service-role only at the RLS layer. No `authenticated` read path reaches them.

## Connection flow

1. Member taps "Connect Google Calendar" in the UI.
2. `startConnectSessionAction` detects `provider=google-*` and returns `/api/oauth/google/start?provider=gcal&categories=...` as the popup URL.
3. `/api/oauth/google/start` validates the session + household context, mints a random `state` and PKCE `code_verifier`, inserts a row into `sync.google_oauth_state`, and redirects (302) to Google's authorize endpoint with `prompt=consent&access_type=offline` (so we always get a refresh token on re-auth).
4. Member consents on Google's page. Google redirects back to `/api/oauth/google/callback?code&state`.
5. Callback consumes+deletes the `sync.google_oauth_state` row, exchanges the code at `https://oauth2.googleapis.com/token` with PKCE verifier + client secret, parses the id_token (no JWKS verification needed — TLS + client-secret auth is sufficient for a direct same-request exchange), encrypts the tokens, upserts `sync.google_connection`, upserts `sync.provider_connection` with `provider='gcal'|'gmail'` and `nango_connection_id=<google_connection.id>`, and runs the post-connect side effects (calendar watch / gmail watch + label).
6. Callback renders a self-closing HTML page that posts `{ ok: true }` to `window.opener`; the existing `ConnectProviderButton` poll also sees the new row.

## Calling a provider from a worker

Workers instantiate `GoogleHttpClient` instead of `NangoClient` for gcal/gmail paths. It satisfies the same `proxy({ providerConfigKey, connectionId, endpoint, method, data, params, headers })` shape so `GoogleCalendarProvider` and `GoogleMailProvider` are byte-identical.

Behavior:
- Lookup `sync.google_connection` by `connectionId` (UUID).
- Decrypt the cached access token; refresh if `access_token_expires_at < now() + 60s` (or missing).
- Refresh path takes a `pg_advisory_xact_lock(hashtext(id))` so concurrent callers don't stampede Google's `/token`.
- On 401 from Google: refresh once, retry once.
- On `invalid_grant` during refresh: flip the row `status='revoked'` and throw a typed error. The caller surfaces it; user sees "reconnect".
- 429 and 403 `quotaExceeded` pass through as `RateLimitError` with `Retry-After` honored.

The composed URL maps `endpoint` to real Google origins:
- Calendar → `https://www.googleapis.com/calendar/v3/...`
- Gmail → `https://gmail.googleapis.com/gmail/v1/...`

## Disconnect

`disconnectConnectionAction` branches on provider. Google rows go through `revokeGoogleConnection`:
1. POST `https://oauth2.googleapis.com/revoke?token=<refresh_token>`. Non-fatal on 400 (already revoked).
2. Tear down side effects: `calendar.unwatch` for gcal, `email.unwatch` for gmail.
3. Update `sync.provider_connection.status='revoked'` and `sync.google_connection.status='revoked'`.
4. Clear `sync.cursor` rows for the connection.

YNAB rows continue through the Nango `deleteConnection` path.

## Cutover

Initial rollout is a clean cutover — existing Nango-brokered Google connections are marked `status='revoked'` via:

```sql
update sync.provider_connection
set status = 'revoked', updated_at = now()
where provider in ('gcal', 'gmail') and status = 'active';
```

Users click "Reconnect" once and land in the new flow. No token migration from Nango.

## Env vars

| Variable | Services | Purpose |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | web, workers | GCP OAuth client id |
| `GOOGLE_OAUTH_CLIENT_SECRET` | web, workers | GCP OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | web | Registered callback URL |
| `GOOGLE_TOKEN_ENCRYPTION_KEY_V1` | web, workers | base64(32-byte) master key |
| `GOOGLE_TOKEN_ENCRYPTION_KEY_V2` | web, workers | Optional; used only during key rotation |

Workers need the encryption key so `GoogleHttpClient.proxy` can decrypt access tokens on outbound calls. The web app needs it to encrypt on callback-write and to power `revokeGoogleConnection`.

## Non-goals

- Multi-account per household (schema allows; UI does not).
- Eager/cron token refresh (lazy is sufficient at current call volume).
- Key rotation tooling (the `key_version` column makes it a single one-off job; skip until needed).
