# HomeHub section skills

Project-level Claude Code skills, one per app section. Each skill is a
playbook for **(a) populating data** in that section and **(b) adding new
tabs/functionality** to that section.

## When to use

Invoke the matching section skill when the user asks to:

- add a new tab under `/calendar`, `/financial`, `/food`, `/fun`, `/social`,
  `/memory`, `/ops`, `/settings`, `/suggestions`, or `/chat`;
- seed demo data for a section;
- wire up CRUD (UI write → server action → Supabase) for a section;
- expose a new capability to the chat's foreground agent (a tool the
  Hermes-backed loop can call) for a section.

## Chat backbone

The foreground chat model is routed through OpenRouter. Default is
`nousresearch/hermes-3-llama-3.1-405b` (Nous Research Hermes 3); override via
`HOMEHUB_FOREGROUND_MODEL`. Model wiring lives in
`apps/workers/foreground-agent/src/model.ts`; the chat route handler is
`apps/web/src/app/api/chat/stream/route.ts`.

Tools the agent can call are registered in `packages/tools/src/tools/` and
exposed through `packages/tools/src/catalog.ts` + `defaultSet.ts`. A tool is a
Zod schema + handler + classification (`read` | `draft-write` | `direct-write`).
Section skills that add agent capabilities should add a tool here.

## Data layer

- Tables live under the `app.*` / `mem.*` / `sync.*` / `audit.*` Postgres
  schemas. Migrations are in `packages/db/supabase/migrations/*.sql`.
- Local dev seed is `packages/db/supabase/seed.sql` — SQL inserts, reset via
  `supabase db reset`. Keep every insert idempotent (`on conflict do nothing`).
- Generated DB types are at `packages/db/src/types.generated.ts`; regenerate
  with `pnpm --filter @homehub/db gen:types` after a migration.

## Tab pattern (same across all sections)

1. Add a route folder `apps/web/src/app/(app)/<section>/<tab>/page.tsx`.
2. Add a tab entry to the section's SubNav (`<Section>SubNav.tsx` under
   `apps/web/src/components/<section>/`) and extend the `Tab.href` literal
   union type.
3. If the section's `layout.tsx` gates on a segment grant, keep the new tab
   under the same gate (no bypass).
4. Colocate data-fetching in a Server Component; wrap interactive pieces in
   `'use client'` children.
5. Add a test file next to the page or component (see any existing
   `*.test.tsx` for the house pattern).
