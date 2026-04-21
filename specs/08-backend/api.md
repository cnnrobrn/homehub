# API

**Purpose.** The server surfaces HomeHub exposes and how they are organized.

**Scope.** HTTP endpoints, server actions, webhooks, MCP tools.

## Surfaces

HomeHub has **four** server surfaces. Keep them distinct; don't let one leak into another.

1. **Server Actions** (in `apps/web`) — the primary mutation path for authenticated UI.
2. **Public API routes** (`app/api/*` on Vercel) — narrow, for things that can't be server actions: OAuth redirects, webhook receivers, file uploads.
3. **MCP tools** (on Railway) — capability surface for background agents and household's external assistants. See [`../03-integrations/mcp.md`](../03-integrations/mcp.md).
4. **Internal worker RPC** — service-to-service calls between workers. Keep these minimal; prefer queue messages.

## Server actions

Canonical pattern:

```ts
'use server';
export async function approveSuggestion(formData) {
  const { user, household } = await requireHouseholdMember();
  const id = formData.get('id');
  // validate suggestion belongs to household
  // enqueue action
  // update suggestion status
}
```

Each action:

- Validates session via Supabase Auth cookie.
- Resolves the caller's household context.
- Checks segment grants.
- Uses Zod for input parsing.
- Writes through Supabase with RLS implicitly enforced.

## Public API routes

| Route                           | Purpose                                            |
|---------------------------------|----------------------------------------------------|
| `POST /api/integrations/connect`| Initiate Nango OAuth flow; returns hosted-auth URL |
| `GET  /api/integrations/callback`| Nango-redirect handler (rarely — usually Nango handles it and webhooks) |
| `POST /api/webhooks/nango`      | Nango webhook receiver                             |
| `POST /api/webhooks/google`     | Pub/Sub push for Gmail/Calendar                    |
| `POST /api/webhooks/stripe`     | (if used for billing HomeHub itself) — TBD          |
| `POST /api/files/upload`        | Direct-to-Storage signed URL issuer                |

All webhook routes verify HMAC / JWT before acting.

## MCP tools

Separate service on Railway. See [`../03-integrations/mcp.md`](../03-integrations/mcp.md) for the full tool catalog.

## Error shape

All HomeHub-originated errors follow:

```
{ error: { code: 'stable_string', message: 'human friendly', details?: {...} } }
```

Stable codes let the UI present specific remediations (`reconnect_provider`, `upgrade_required`, `quorum_pending`).

## Rate limits

- Per-user rate limits on public routes.
- Per-household budget on model-bearing endpoints (see [`../05-agents/model-routing.md`](../05-agents/model-routing.md)).
- Per-token rate limit on MCP.

## Versioning

- Server actions: co-versioned with the app; no external contract to preserve.
- Public API: versioned under `/api/v1/*` if / when a public API exists (not in v1).
- MCP: semver of the server; tools add forward-compatibly; removals require notice.

## Dependencies

- [`workers.md`](./workers.md)
- [`../07-frontend/ui-architecture.md`](../07-frontend/ui-architecture.md)

## Open questions

- Do we need a BFF (Backend-For-Frontend) layer between Next.js and Supabase? No — server components already play that role.
- Public API for household-owned automations (Zapier, etc.): post-v1, gated on MCP-via-bridge design.
