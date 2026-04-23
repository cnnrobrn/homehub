---
name: social-section
description: Populate data and add tabs/functionality in the Social section (/social). Use when the user wants to seed people/groups/birthdays, add a new social tab (e.g. cards, gifts, touchpoints), wire a server action for people/group writes, or expose a social tool to the Hermes chat agent.
---

# Social section

People, groups, relationship cadence, birthdays.

## Surface area

- Route root: `apps/web/src/app/(app)/social/` with `layout.tsx` +
  `SocialSubNav`.
- Current tabs (`apps/web/src/components/social/SocialSubNav.tsx`):
  Overview, People, Groups, Calendar, Summaries, Alerts.
- Data tables: `app.person` (migration
  `packages/db/supabase/migrations/0004_household.sql`). Groups are derived
  or live in a newer migration — grep before assuming. Birthdays project
  into `app.event`; reciprocity is computed from `app.event` +
  `app.transaction` + `mem.fact`.
- Components: `apps/web/src/components/social/*` (`PersonTable`,
  `PersonDetail`, `GroupList`, `GroupDetailView`, `ReciprocityCard`,
  `BirthdayCountdown`).
- Agent tools: `getHouseholdMembers.ts` (for connected members).
  People-oriented tools flow through `queryMemory.ts` against `mem.node`
  with `node.type='person'`.
- Materializer worker: `apps/workers/social-materializer` — rebuilds
  derived social rows after facts/events change.

## Populate data

1. **Local dev seed (SQL)** — append to `packages/db/supabase/seed.sql`.
   Seed order: `app.person` → `app.event` (birthdays with
   `source='social'`) → `mem.node` entries if you want them to surface in
   people lists via the memory graph.
2. **Chat-driven** — people data is usually written through the memory
   graph, not directly. To add a capability like "log a touchpoint",
   either (a) add a `mem.fact` via the reflector/query-memory pipeline, or
   (b) create a new direct-write tool in `packages/tools/src/tools/`.
3. **UI write path** — server actions for manual people edits under
   `apps/web/src/app/actions/social/` (create if missing). Remember to
   trigger the social-materializer via queue on writes that affect
   reciprocity or cadence.

## Add a tab

1. Create `apps/web/src/app/(app)/social/<tab>/page.tsx`.
2. Extend `Tab.href` union and `TABS` in `SocialSubNav.tsx`.
3. Reuse `SocialRealtimeRefresher` at the layout level for live updates.
4. If the tab depends on derived rows, check `social-materializer`
   invariants — don't render stale projections.

## Gotchas

- `app.person` is distinct from `app.member` (connected household members)
  — a social entry is not automatically a member.
- Birthdays are stored as `mm-dd` on `app.person` but materialized as
  dated `app.event` rows; edit the person row, let the materializer fan
  out, don't insert events directly.
- `mem.node` is the canonical identity; people rows reference the node
  via `node_id` nullable — handle both linked and unlinked rows.
