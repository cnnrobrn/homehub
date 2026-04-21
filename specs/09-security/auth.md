# Authentication & Authorization

**Purpose.** How users sign in and how we decide what they can do.

**Scope.** User auth, household membership, per-segment grants, service-to-service.

## User authentication

- **Supabase Auth** is the source of truth.
- Providers v1: **Google OAuth** (preferred), **Email magic link** (fallback).
- **Apple Sign In** post-v1 if a mobile push surfaces demand.
- Sessions carried as httpOnly cookies. `@supabase/ssr` on the Next.js side.

## Multi-factor

- Google-backed sessions inherit the member's Google MFA.
- For email magic-link accounts, we strongly recommend setting a password + TOTP once Supabase Auth supports the flow we need; tracked.

## Household membership

See [`../02-data-model/households.md`](../02-data-model/households.md) for the detailed model. Briefly:

- A user can belong to multiple households.
- Each membership has a role and per-segment grants.
- The UI's `getHouseholdContext()` resolves the active household from URL / cookie.

## Authorization

Two checks on every mutation:

1. **Membership** — the user is a member of the target household.
2. **Grant** — the user has `write` (or `read`) access for the target segment / account.

Both are expressed in DB helper functions and enforced via RLS. Server actions additionally check in application code for better error messages.

## Service-to-service

- **Workers → Supabase:** service-role JWT. Scoped minimally; separated keys per worker class where feasible.
- **Workers → Nango:** a Nango secret key; confined to workers that touch providers.
- **Workers → OpenRouter:** an API key; confined to workers that call models.
- **MCP servers → HomeHub core:** a signed HMAC token per MCP server.
- **MCP clients (household's external assistant) → MCP servers:** per-member MCP tokens issued in-app; scoped; revokable.

## Session lifecycle

- Session expires after 30 days of inactivity (configurable).
- Sensitive mutations (remove member, delete household, disconnect provider, change ownership) require re-authentication within the last 5 minutes.

## Dependencies

- [`threat-model.md`](./threat-model.md)
- [`../02-data-model/households.md`](../02-data-model/households.md)
- [`../02-data-model/row-level-security.md`](../02-data-model/row-level-security.md)

## Open questions

- Delegated access for a trusted non-member (e.g., a financial advisor the household brings in temporarily)? Out of scope v1.
- Session device list + revoke-all: useful, include in v1.
