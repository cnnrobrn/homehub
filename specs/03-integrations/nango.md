# Nango (Self-hosted)

**Purpose.** Nango is the only path HomeHub code takes to reach a third-party provider that needs OAuth or similar credentialed access. Self-hosted so the household owns the token path.

**Scope.** How we deploy it, how we register providers, how workers call it, and the boundary between Nango and MCP.

## Deployment

- Official Nango Docker image, pinned to a specific version.
- Runs as a Railway service with its own Postgres (Railway-hosted) for Nango's internal store. We do not reuse Supabase for Nango state.
- Nango is reachable only from other Railway services via Railway's private networking. Not exposed to the internet except for the OAuth redirect URL.
- Secrets: provider client IDs/secrets set via Railway variables; never checked into the repo.

## Provider registry

Each supported provider is a Nango "integration" configured via Nango's admin UI or declarative config file. v1 providers:

| Provider        | Purpose                              | Auth         |
|-----------------|--------------------------------------|--------------|
| google-calendar | Calendar read/write                  | OAuth 2      |
| google-mail     | Gmail read, label, watch             | OAuth 2      |
| monarch         | Transactions, accounts, budgets      | OAuth/API key depending on availability |
| ynab            | Transactions, accounts, budgets      | OAuth 2      |
| plaid           | Fallback financial aggregator        | Plaid Link    |
| instacart       | Grocery ordering (via partner API)   | OAuth / key  |

If a provider is not yet in Nango's catalog, we either add a custom provider definition upstream (preferred) or front it with an MCP server (see [`mcp.md`](./mcp.md)).

## Connection flow

1. Member taps "Connect Gmail" in the UI.
2. Frontend hits `/api/integrations/connect` on Vercel, which:
   - Creates a Nango session token scoped to `(household_id, member_id, provider)`.
   - Returns a hosted-auth URL.
3. Member completes OAuth on Nango's hosted page.
4. Nango webhook fires on success → Railway sync worker receives `connection.created`.
5. Worker inserts `sync.provider_connection` row and enqueues an initial `sync_full` job.

## Calling a provider from a worker

Workers never hold raw tokens. They call Nango proxy endpoints:

```ts
const response = await nango.proxy({
  providerConfigKey: 'google-calendar',
  connectionId,
  method: 'GET',
  endpoint: '/calendar/v3/calendars/primary/events',
  params: { timeMin, timeMax, syncToken },
});
```

Nango refreshes tokens transparently. If Nango returns `connection_invalid`, the worker marks `sync.provider_connection.status = 'needs_reauth'` and the UI prompts re-connection.

## Webhooks from providers

- Gmail: Gmail Watch → Google Pub/Sub → a Railway webhook service → Nango for auth verification → job queued.
- Google Calendar: push notifications → same path.
- Financial providers: poll-only for v1 (webhooks often unreliable).
- Grocery order updates: provider-specific; prefer webhook via Nango where supported.

All webhooks share a single Railway `webhook-ingest` service with provider-specific routers; this keeps our public attack surface to a single hostname + HMAC-verified endpoints.

## Disconnection & revocation

- Member can disconnect in UI → Vercel → Nango `delete connection` → Railway worker cleans up cursors and marks connection `revoked`.
- If a provider rejects our tokens (explicit revoke on their side), we mirror the same cleanup.
- Historical data is *not* deleted on disconnection; only future syncs stop. Deletion of historical data is a separate member-initiated action.

## Operational concerns

- **Backups:** Nango's Postgres is backed up nightly by Railway plus weekly logical dump into Supabase Storage for our own redundancy.
- **Upgrades:** Nango is pinned; upgrades go through staging first with integration tests per provider.
- **Monitoring:** Nango health check + a canary connection per provider that a synthetic monitor refreshes daily.

## Dependencies

- [`mcp.md`](./mcp.md) — Nango's complement for non-OAuth sources.
- [`../01-architecture/data-flow.md`](../01-architecture/data-flow.md)
- [`google-workspace.md`](./google-workspace.md), [`budgeting.md`](./budgeting.md), [`grocery.md`](./grocery.md)

## Open questions

- Do we expose Nango's connection UI directly to members or wrap it in our own? Leaning wrap-it for brand consistency; Nango supports headless mode.
- Multi-account-per-provider per member (e.g., two Gmail addresses): supported by Nango via distinct connection ids. Need UI affordance.
