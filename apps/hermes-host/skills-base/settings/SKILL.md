---
name: settings
description: Read household, member, and connection settings. Do not mutate; settings changes are owner-only UI actions.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, settings]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
    required_for: all queries
  - name: HOMEHUB_SUPABASE_URL
    required_for: database access
  - name: HOMEHUB_SUPABASE_ANON_KEY
    required_for: PostgREST apikey header
  - name: HOMEHUB_SUPABASE_JWT
    required_for: household-scoped Authorization bearer
---

# Settings

See `_shared` for auth/scoping rules. **Read-only.** All mutations must go through `/settings` UI.

## When to Use

- User asks who is in the household, member roles, or access grants.
- User wants to know what provider connections are active (Google, Slack, etc.).
- User inquires about household preferences or member segment access.

## Read: Household

```bash
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/household?household_id=eq.$HOUSEHOLD_ID"
```

Key columns: `id`, `name`, `timezone`, `settings` (jsonb).

## Read: Members

```bash
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/member?household_id=eq.$HOUSEHOLD_ID&order=created_at.asc"
```

Key columns: `id`, `display_name`, `role`, `invited_at`, `joined_at`.
Role is check-constrained enum: `owner`, `admin`, `editor`, `viewer`.

## Read: Segment Grants

```bash
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/member_segment_grant?household_id=eq.$HOUSEHOLD_ID"
```

Key columns: `member_id`, `segment`, `granted_at`.

## Read: Provider Connections

```bash
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: sync" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/provider_connection?household_id=eq.$HOUSEHOLD_ID&order=created_at.desc"
```

Key columns: `id`, `provider`, `status`, `last_sync_at`, `error_message`.

## Do NOT Write

- Household name, timezone, member role, or connection state are owner-only.
- Propose edits in the `/settings` UI; don't execute directly.

## Pitfalls

- `household.settings` is jsonb; parse carefully if you inspect it.
- `member.role` is check-constrained; don't invent values.
- Provider connections live in `sync` schema; use `Accept-Profile: sync`.
- Household and member data live in `app` schema; use default `Accept-Profile: app`.
