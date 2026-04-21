# UI Architecture

**Purpose.** How the Next.js app is structured.

**Scope.** App Router layout, server vs. client components, data access.

## App Router layout

```
app/
  (public)/
    login/
    invite/[token]/
  (app)/
    layout.tsx              # auth boundary + household context + global ⌘K launcher
    page.tsx                # dashboard (combined)
    chat/                   # first-party chat surface
      page.tsx              # full-page conversation list + active thread
      [conversationId]/page.tsx
    financial/
      page.tsx              # segment dashboard
      calendar/page.tsx
      transactions/page.tsx
      ...
    food/...
    fun/...
    social/...
    memory/                 # graph browser
      page.tsx              # search + index
      [nodeType]/[nodeId]/page.tsx
    settings/
      household/page.tsx
      connections/page.tsx
      members/page.tsx
      notifications/page.tsx
      memory/page.tsx       # pause/forget, retention windows, rule authoring
  api/
    integrations/connect/route.ts
    webhooks/[provider]/route.ts   # if needed at edge
    chat/stream/route.ts           # streaming turn endpoint
```

## Server / client split

- Default to **Server Components**. Most pages are server-rendered lists + details.
- Drop to Client Components for:
  - Drag-and-drop (meal planner, calendar rescheduling).
  - Real-time subscriptions (dashboard live updates).
  - Forms with complex interactivity.
- Server actions for mutations; no client-side fetch-and-mutate patterns.

## Data access

- `@supabase/ssr` with cookie-based session on server.
- Client components use Supabase JS client for realtime subscriptions only; reads still prefer server-component passes through props.
- A shared `getHouseholdContext()` helper enforces "user belongs to a household" on every authenticated page.

## Styling

- Tailwind. Design tokens in `tailwind.config`.
- shadcn/ui for primitives (Dialog, Sheet, Calendar grid).
- Dark mode default; light mode toggle in settings.

## Accessibility

- Every interactive element keyboard-reachable.
- Color is never the only signal (alert severity encoded with an icon too).
- Follows WCAG AA for contrast.

## Performance

- Route-level streaming where possible.
- Suspense boundaries per segment panel so the dashboard paints in pieces.
- No client-side data fetching on initial load — all via server components.

## State

Most state lives server-side. Exceptions:

- Meal planner drag state — Zustand store, scoped to the planner route.
- Calendar view prefs (week vs. month, filters) — URL search params.

## Dependencies

- [`pages.md`](./pages.md)
- [`components.md`](./components.md)
- [`realtime.md`](./realtime.md)

## Open questions

- SWR / React Query for any client-side data needs? Lean "no" until a real need surfaces.
- PWA / mobile installability: target post-v1; v1 is responsive web.
