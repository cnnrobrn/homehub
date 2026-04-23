---
name: settings-section
description: Populate data and add tabs/functionality in the Settings section (/settings). Use when the user wants to seed household/members/connections/auto-approval/notifications/memory settings, add a new settings tab (e.g. billing, preferences, security), wire a settings server action, or expose a settings tool to the Hermes chat agent.
---

# Settings section

Per-household administration: members, invites, provider connections,
auto-approval rules, notification channels, memory preferences.

## Surface area

- Route root: `apps/web/src/app/(app)/settings/` with `layout.tsx` +
  `SettingsNav`.
- Current tabs (`apps/web/src/components/settings/SettingsNav.tsx`):
  Household, Members, Connections, Notifications, Memory.
- Data tables:
  - `app.household`, `app.member`, `app.member_segment_grant`,
    `app.household_invitation`, `app.account_grant`
    (migration `0004_household.sql`).
  - `sync.provider_connection` (`0009_sync_audit_model_calls.sql`) —
    Nango-linked integrations.
  - Notification prefs and auto-approval thresholds live on per-member
    JSON columns — grep for `notification_prefs` / `auto_approval`
    before assuming table shape.
- Components: `apps/web/src/components/settings/*` and
  `components/settings/memory/*`. Key forms: `HouseholdSettingsForm`,
  `MemberList`, `InviteForm`, `PendingInvitations`, `ConnectionsTable`,
  `EmailConnectDialog`, `AutoApprovalForm`.
- Agent tools: none today — settings are owner-gated UI actions.

## Populate data

1. **Local dev seed (SQL)** — append to
   `packages/db/supabase/seed.sql`. Seed order (mandatory): `app.household`
   → `app.member` (with a known `supabase_user_id` so login works) →
   `app.member_segment_grant` (one row per segment the member reads) →
   optional `app.household_invitation`. Use a stable UUID for the demo
   household so other seeded rows can reference it.
2. **UI write path** — every settings surface has a server action. Don't
   write through the service client from the page; use the action so
   audit rows and revalidation fire. Audit writes to `audit.event` are
   not automatic — add them explicitly on sensitive edits.
3. **Chat-driven** — discouraged. Settings changes are owner-only and
   usually require explicit UI confirmation. If adding a tool, restrict
   to `read` classification (e.g. "list my connections").

## Add a tab

1. Create `apps/web/src/app/(app)/settings/<tab>/page.tsx`.
2. Extend the `SettingsNav.tsx` tab list.
3. If the tab is owner-only (most are), gate via the member role check
   at the top of the page — the layout gate is segment-based, not
   role-based.
4. Forms follow React Server Components + server actions; look at
   `HouseholdSettingsForm.tsx` for the conventions (optimistic UI,
   `useActionState`, toast on resolve).
5. Add a test if the tab has non-trivial interactive state.

## Gotchas

- `app.member_segment_grant` is the source of truth for what a member
  can see in every other section; a settings write here must trigger a
  revalidate across affected routes, not just `/settings/members`.
- Invitations have an `expires_at` — the list view should filter
  expired rows by default, with a toggle to show them.
- Provider connections are linked to Nango via `connection_id`;
  deleting the row does not revoke upstream — call Nango first, then
  delete locally, and record the result in `audit.event`.
- Notification prefs are per-channel; a migration adding a channel
  needs both the schema change and a default backfill.
