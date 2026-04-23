---
name: calendar-section
description: Populate data and add tabs/functionality in the Calendar section (/calendar). Use when the user wants to seed calendar events, add a new calendar tab/view (week, agenda, filters), wire a server action for event CRUD, or expose a calendar tool to the Hermes chat agent.
---

# Calendar section

Unified calendar view. Aggregates events from `app.event` plus per-segment
calendar tabs (`/financial/calendar`, `/food/calendar`, `/fun/calendar`,
`/social/calendar`) that re-project domain data as events.

## Surface area

- Route root: `apps/web/src/app/(app)/calendar/page.tsx` (single page today —
  no SubNav yet; first new tab should introduce a `CalendarSubNav.tsx`).
- Data table: `app.event` (migration
  `packages/db/supabase/migrations/0005_event_transaction_account.sql`).
- Shared event type and adapters: search `apps/web/src/lib/` and
  `apps/web/src/components/` for `event` / `EventItem` helpers; financial
  events are projected via `components/financial/transactionsToCalendarItems.ts`.
- Agent tools: `packages/tools/src/tools/listEvents.ts`,
  `proposeAddToCalendar.ts`.

## Populate data

Pick the mode that matches the ask:

1. **Local dev seed (SQL)** — append idempotent inserts to
   `packages/db/supabase/seed.sql` for `app.event`. Reset with
   `supabase db reset`. Include `household_id`, `starts_at`, `ends_at`,
   `title`, `source` (`manual` / `gcal` / `financial` / `food` / `fun` /
   `social`).
2. **Chat-driven (tool call)** — the `propose_add_to_calendar` tool already
   exists. If a new capability is needed (e.g. bulk import, recurring), add a
   new file in `packages/tools/src/tools/` mirroring the shape of
   `proposeAddToCalendar.ts` and register it in `catalog.ts` + `defaultSet.ts`.
3. **UI write path** — add a server action under
   `apps/web/src/app/actions/calendar/` that validates with Zod, calls the
   service Supabase client, and revalidates the calendar route.

## Add a tab

1. Create `apps/web/src/app/(app)/calendar/<tab>/page.tsx` (Server Component).
2. If this is the first tab, introduce
   `apps/web/src/components/calendar/CalendarSubNav.tsx` (model on
   `FinancialSubNav.tsx`) and render it from the calendar page or a new
   `calendar/layout.tsx`.
3. Otherwise extend the existing `Tab.href` union and `TABS` array.
4. Reuse the `EventItem` projection pattern — do not duplicate event shape.
5. Add a `page.test.tsx` next to the route.

## Gotchas

- `app.event.source` is a check-constrained enum — extending it requires a
  migration, not just a code change.
- RLS on `app.event` is scoped to `household_id` via `app.current_household()`;
  always go through the service client for background writes.
