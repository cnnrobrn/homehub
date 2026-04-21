# HomeHub

HomeHub is an AI-powered control panel for the household. It unifies the information streams that run a home — money, meals, leisure, and relationships — into a single surface that can summarize, coordinate, and suggest. Each family member connects their own accounts (calendars, email, budgeting tools, etc.), and HomeHub weaves the data into a shared memory that the household's AI agents reason over.

Start with [`spec.md`](./spec.md) for the top-level overview and [`specs/`](./specs/) for the per-topic design tree.

## Repository layout

This is a pnpm monorepo. The workspace globs are already configured; the packages below will be filled in by later M0 chunks.

- `apps/web/` — Next.js control panel (shell landed in M0-D; real UI ships with `@frontend-chat` in M1). See [`apps/web/README.md`](./apps/web/README.md).
- `apps/workers/*` — Railway worker services, one per worker class (coming in M0-E).
- `apps/mcp/*` — MCP servers (coming in M0-E).
- `packages/db/` — Supabase migrations, local stack config, and generated types. See [`packages/db/README.md`](./packages/db/README.md).
- `packages/worker-runtime/` — shared worker runtime: Supabase client, `pgmq` wrapper, Nango client, OpenRouter helper, logger, tracer (coming in M0-C).
- `packages/shared/`, `packages/providers/`, `packages/prompts/`, `packages/tools/` — domain primitives and provider/prompt/tool catalogs.
- `specs/` — design specs. Source of truth for what to build.
- `scripts/` — launch scripts and agent briefings.
- `tasks/` — shared task board and decision log.

## Prerequisites

- Node.js 20 LTS. The repo pins a specific 20.x in [`.nvmrc`](./.nvmrc); use `nvm use` or a compatible version manager.
- pnpm 9. The version is pinned via `packageManager` in [`package.json`](./package.json); enable Corepack (`corepack enable`) and it will pick the right version automatically.

## Getting started locally

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm format:check
```

Boot the local Supabase stack (requires Docker running):

```bash
pnpm --filter @homehub/db db:start    # Postgres + PostgREST + Studio
pnpm --filter @homehub/db db:status   # URLs + service keys
pnpm --filter @homehub/db db:stop
```

Additional commands (Nango docker-compose, seed data, dev servers) arrive with later M0 chunks:

- Worker runtime + queue wiring: coming in M0-C.
- Next.js app shell: ships in M0-D (`pnpm --filter @homehub/web dev`).
- Worker + MCP service stubs: coming in M0-E.
- Local Nango via docker-compose: coming in M0-F.

## CI

GitHub Actions runs `lint`, `typecheck`, `format-check`, and `migration-lint` on every push to `main` and every pull request. See [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## Multi-agent orchestration

HomeHub is built by five focused Claude Code agents: one coordinator and four specialists (`@infra-platform`, `@integrations`, `@memory-background`, `@frontend-chat`). The coordinator owns the task board and reviews; specialists implement in their lanes. See [`scripts/agents/README.md`](./scripts/agents/README.md) for the full orchestration model, briefings, and launch flow.

## Contributing

- Conventional commits are enforced via commitlint on `commit-msg`.
- Prettier + ESLint run on staged files via lint-staged on `pre-commit`.
- Never push directly to `main`; open a PR and let CI run.
