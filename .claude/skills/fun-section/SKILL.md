---
name: fun-section
description: Populate data and add tabs/functionality in the Fun section (/fun). Use when the user wants to seed trips/queue items/outings, add a new fun tab (e.g. wishlists, bookings), wire a server action for queue/trip writes, or expose a fun tool to the Hermes chat agent.
---

# Fun section

Outings, trips, queued activities.

## Surface area

- Route root: `apps/web/src/app/(app)/fun/` with `layout.tsx` + `FunSubNav`.
- Current tabs (`apps/web/src/components/fun/FunSubNav.tsx`):
  Overview, Trips, Queue, Calendar, Summaries, Alerts.
- Data: fun rows currently live in `app.event` (with `source = 'fun'`)
  plus trip/queue-specific rows — grep
  `packages/db/supabase/migrations/` for the current trip/queue schema
  before assuming table names. If a dedicated table doesn't exist yet,
  adding one is a new migration.
- Components: `apps/web/src/components/fun/*` (`TripList`, `TripTimeline`,
  `QueueList`, `CreateQueueItemForm`, `FunEventsCalendar`,
  `OutingSuggestionCard`).
- Agent tools: `proposeBookReservation.ts` (draft-write). Fun-specific
  read tools flow through `listEvents` filtered by `source`.

## Populate data

1. **Local dev seed (SQL)** — append inserts to
   `packages/db/supabase/seed.sql` for fun events / queue items. Use
   `app.event` with `source='fun'` until/unless a dedicated table exists.
2. **Chat-driven** — for new capabilities (e.g. `addToQueue`,
   `markTripPlanned`), add a file in `packages/tools/src/tools/` and wire
   into `catalog.ts` + `defaultSet.ts`. Prefer `draft-write` for anything
   that commits money or calendar time; reserve `direct-write` for
   low-stakes queue mutations.
3. **UI write path** — `CreateQueueItemForm.tsx` already pairs with a
   server action; model new writes on it. Revalidate `/fun/queue` or the
   affected tab on success.

## Add a tab

1. Create `apps/web/src/app/(app)/fun/<tab>/page.tsx`.
2. Extend `Tab.href` union and `TABS` in `FunSubNav.tsx`.
3. If the tab renders calendar-shaped data, reuse `FunEventsCalendar.tsx`.
4. `FunRealtimeRefresher` is mounted layout-level — don't re-mount.
5. Add a test for any new component.

## Gotchas

- Trips currently derive their timeline from `app.event`; a dedicated
  `trip` table would need a migration plus a reconciler/materializer
  update (see `apps/workers/social-materializer` for the pattern).
- Suggestion-backed items (outing recommendations) go through
  `app.suggestion` with `segment='fun'`; don't write directly to
  `app.event` for AI-proposed outings.
