# `@homehub/web`

The HomeHub control-panel web app — a Next.js 15 App Router project on Vercel.

> **M0 scope.** This package is intentionally a **shell**: a deployable,
> typecheckable Next.js project with the design-system token layer, the
> `@supabase/ssr` helpers, and a `/api/health` probe. The real page tree
> (dashboard, per-segment UIs, memory graph browser, first-party chat)
> lands in M1 under `@frontend-chat` per
> [`specs/07-frontend/ui-architecture.md`](../../specs/07-frontend/ui-architecture.md).

## What's here

```
apps/web/
├── next.config.ts          # minimal; typedRoutes on
├── postcss.config.mjs      # Tailwind v4 via @tailwindcss/postcss
├── tsconfig.json           # extends root base, @/* paths
├── eslint.config.mjs       # root flat config + eslint-config-next via FlatCompat
└── src/
    ├── app/
    │   ├── layout.tsx      # Inter + JetBrains Mono, dark default
    │   ├── page.tsx        # "HomeHub — setup in progress" landing
    │   ├── globals.css     # Tailwind v4 @theme bridge
    │   └── api/health/
    │       └── route.ts    # GET -> { ok, service, version, ts }
    ├── lib/
    │   ├── cn.ts           # clsx + tailwind-merge
    │   ├── env.ts          # publicEnv + serverEnv(), build-phase opt-out
    │   └── supabase/
    │       ├── server.ts   # createClient() + getSession() for Server Components
    │       └── client.ts   # createClient() for Client Components (realtime only)
    ├── components/ui/      # shadcn primitives land here in M1
    └── styles/tokens.css   # design-system CSS variables (dark default, light override)
```

## Develop

From the repo root:

```bash
corepack enable              # once per machine
pnpm install
pnpm --filter @homehub/web dev
```

The dev server boots at <http://localhost:3000>. Verify liveness at
<http://localhost:3000/api/health>.

> **Port 3000 is exclusively owned by `@frontend-chat`** per
> [`scripts/agents/frontend-chat.md`](../../scripts/agents/frontend-chat.md).
> The coordinator may also run it for review. No other specialist
> should start a second server.

## Environment

Required at runtime (throw on missing):

| Var                             | Source                           | Notes                                                  |
| ------------------------------- | -------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project                 | Inlined into the client bundle.                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project                 | Inlined into the client bundle.                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase project                 | Server-only. Never import from client components.      |
| `NEXT_PUBLIC_APP_URL`           | Deployment URL                   | Used for OAuth redirects & OpenRouter referer headers. |
| `NODE_ENV`, `LOG_LEVEL`         | Inherited from `@homehub/shared` | Defaults applied.                                      |

**Build-time opt-out.** When `NEXT_PHASE === 'phase-production-build'`,
the env schema relaxes to optional + default-empty so `next build` on CI
doesn't require live Supabase secrets. This is a build-only relaxation;
`next start` and serverless invocations still demand real values. See
[`src/lib/env.ts`](./src/lib/env.ts).

An `.env.example` lives next to this README; copy to `.env.local` and
fill in the values for local dev.

## Scripts

| Script         | What                                     |
| -------------- | ---------------------------------------- |
| `dev`          | `next dev` on :3000                      |
| `build`        | `next build` — production build          |
| `start`        | `next start` — serve a prebuilt app      |
| `lint`         | `eslint .` — see "Lint" note below       |
| `typecheck`    | `tsc --noEmit` — strict TypeScript check |
| `format:check` | `prettier --check .`                     |

## Lint

We use `eslint .` with a flat config that extends the root
[`eslint.config.mjs`](../../eslint.config.mjs) and layers
`eslint-config-next` via `FlatCompat`. Two decisions are worth calling
out, since the spec flagged them as likely friction points:

1. **No `next lint`.** `next lint` is deprecated in Next 16 and already
   emits a warning in 15.5. It also can't find flat configs reliably
   from the `apps/web` subtree (it expects legacy `.eslintrc` inheritance
   semantics). The root `eslint` CLI handles both correctly.
2. **`eslint.ignoreDuringBuilds: true` in `next.config.ts`.** `next build`
   runs its own lint pass under the same legacy codepath and reports
   spurious "Next.js plugin not detected" warnings. Since CI already runs
   `pnpm lint` across the monorepo, the `next build` lint pass is
   redundant; disabling it avoids duplicating the config gymnastics
   inside `next build`.

Rule conflicts between the root's `import/order` and Next's preset are
resolved in `apps/web/eslint.config.mjs` by re-asserting the root rule
after the Next compat layer — so the monorepo-wide ordering stays the
single source of truth.

## Design-system tokens

CSS variables are the source of truth. They live in
[`src/styles/tokens.css`](./src/styles/tokens.css) and are exposed to
Tailwind v4 via the `@theme` block in
[`src/app/globals.css`](./src/app/globals.css). Change a token in one
place; both CSS consumers and Tailwind utility classes update together.

- Colors: `--color-bg`, `--color-surface`, `--color-border`, `--color-fg`,
  `--color-fg-muted`, `--color-accent`, `--color-accent-fg`,
  `--color-warn`, `--color-danger`, `--color-success`.
- Radii: `--radius-sm`, `--radius-md`, `--radius-lg`.
- Fonts: `--font-sans` (Inter), `--font-mono` (JetBrains Mono), both
  provided by `next/font/google` in [`src/app/layout.tsx`](./src/app/layout.tsx).
- Theme: dark default (`<html data-theme="dark">`). A light override is
  wired (`[data-theme="light"]`) but no toggle UI until M1.

## Supabase

Use the server helper from Server Components, Route Handlers, and Server
Actions:

```ts
import { createClient, getSession } from '@/lib/supabase/server';

export default async function Page() {
  const session = await getSession();
  // ...
}
```

Use the browser helper ONLY from Client Components that need realtime:

```ts
'use client';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
const channel = supabase.channel('realtime:public').on(/* ... */);
```

Direct Supabase reads from components are prohibited — route data
through Server Components or Server Actions per
[`specs/07-frontend/ui-architecture.md`](../../specs/07-frontend/ui-architecture.md).

## Related specs

- [`specs/07-frontend/ui-architecture.md`](../../specs/07-frontend/ui-architecture.md) — authoritative
- [`specs/07-frontend/pages.md`](../../specs/07-frontend/pages.md)
- [`specs/07-frontend/components.md`](../../specs/07-frontend/components.md)
- [`specs/13-conversation/overview.md`](../../specs/13-conversation/overview.md)

## Not yet

- Auth flows, middleware, household context helper (M1, `@infra-platform` + `@frontend-chat`).
- shadcn/ui primitives (added on demand in M1).
- Page tree beyond `/` and `/api/health` (M1+).
- Realtime subscriptions (M1+).
- Vercel project binding (human-gated on Vercel dashboard; no `vercel.json` checked in).
