# Agent Operations

**Purpose.** The runbook for the cmux-based multi-agent setup: staged launch, worktree layout, serialized ownership, and the gotchas that make running five Claude Code instances against one repo tractable.

## Stages

Run the script with the stage number. Stages are additive and idempotent — re-running is safe.

```
./scripts/cmux-launch.sh 1     # coordinator only
./scripts/cmux-launch.sh 2     # add infra-platform
./scripts/cmux-launch.sh 3     # add integrations, memory-background, frontend-chat
./scripts/cmux-launch.sh all   # all five at once (not recommended before M0)
```

The recommended cadence:

1. **Stage 1.** Launch the coordinator alone. Let it read the spec tree, sanity-check `tasks/todo.md`, and post a kickoff message to `tasks/review.md`. Nothing is built yet.
2. **Stage 2** once the coordinator reports *M0 ready for dispatch*. The infra-platform specialist does M0 alone (monorepo scaffolding, Supabase project, Nango deploy, CI). No parallel work is possible at this point.
3. **Stage 3** once M0 is fully `[x]` in `tasks/todo.md`. The other three specialists come online and start M1+ in parallel.

## Worktree layout

Worktrees live at a sibling path of the repo, not inside it:

```
~/Documents/
├── homehub/                            # main checkout — coordinator works here
└── homehub-worktrees/
    ├── infra-platform/                 # branch: agent/infra-platform
    ├── integrations/                   # branch: agent/integrations
    ├── memory-background/              # branch: agent/memory-background
    └── frontend-chat/                  # branch: agent/frontend-chat
```

The launch script creates branches and worktrees as needed. Each specialist's window opens with `cwd` set to its worktree, so they can't accidentally edit `main` — they literally don't have it checked out.

The coordinator works in the main checkout on `main`, reviews PRs, and merges.

## Serialized ownership

| Resource                                    | Owner                    |
|---------------------------------------------|--------------------------|
| `main` branch                               | coordinator (merges only)|
| `tasks/todo.md` structure                   | coordinator              |
| `tasks/review.md`                           | coordinator              |
| Spec edits (`specs/`)                       | coordinator (via PR)     |
| `.claude/settings.json`                     | human-managed            |
| DB migrations (`packages/db/migrations/`)   | `@infra-platform`        |
| Supabase project config                     | `@infra-platform`        |
| Nango deployment                            | `@infra-platform`        |
| Nango provider config (within Nango admin)  | `@integrations`          |
| Railway services (provisioning)             | `@infra-platform`        |
| Railway service code (per worker)           | the worker's owner       |
| Next.js dev server (port 3000)              | `@frontend-chat` / coordinator |
| Next.js code (`apps/web/`)                  | `@frontend-chat`         |
| Tool catalog (`packages/tools/`)            | `@frontend-chat`         |
| Provider adapters (`packages/providers/`)   | `@integrations`          |
| Extraction prompts (`packages/prompts/`)    | `@memory-background`     |
| Foreground agent loop                       | `@frontend-chat`         |
| `query_memory` implementation               | `@memory-background`     |
| Action executor (state machine)             | `@memory-background`     |
| Action executor (provider calls)            | `@integrations`          |
| OpenRouter API key (usage / limits)         | `@infra-platform`        |

When a specialist needs something from another's lane, they open a task in `tasks/todo.md` addressed to the owner via a commit on their branch. The coordinator adopts it into the main board on merge.

## Permission model

`.claude/settings.json` at the repo root defines:

- **Allow:** read/write/edit anywhere under the repo; safe Bash (`pnpm`, `npx`, read-only git, `gh` for PRs, `supabase` non-destructive, `docker compose` non-destructive).
- **Deny:** `rm`, `git push --force`, `git reset --hard`, `git clean -f`, `git branch -D`, `supabase db reset`, `docker volume rm`, `sudo`, reading `.env*`, writing `.claude/settings.json` itself.

`.claude/settings.local.json` is `.gitignored`; use it for per-machine overrides if needed.

Workers run with `--permission-mode acceptEdits`, so edits to files don't prompt. Bash commands outside the allowlist will prompt — that's intentional and a feature.

## PR flow

Specialists:

1. Work in worktree on their branch.
2. Commit frequently. Push to `origin/agent/<name>`.
3. When a task is done: `gh pr create --base main --title "..." --body "..."`, mark `[r]` in `tasks/todo.md` on their branch, stop, wait.

Coordinator:

1. `gh pr list --state open` to see pending PRs.
2. `gh pr diff <n>`, `gh pr view <n> --comments` to review.
3. `gh pr merge <n> --squash --delete-branch` to land.
4. Update `tasks/todo.md` on `main` to `[x]`, append to `tasks/review.md`.
5. If there are follow-ups, add new tasks and re-assign.

## Gotchas

### Migration numbering races

Two specialists could both generate migration `0007_*.sql` in parallel. Migrations are single-owner (`@infra-platform`) precisely to avoid this. If a non-owner believes they need a migration, they request it via the board and wait.

### pnpm install concurrency

Each worktree has its own `node_modules` but pnpm's content-addressable store is shared. This is fine — pnpm handles concurrency. Running `pnpm install` in multiple worktrees simultaneously is safe.

### Dev-server port

Only one Next.js dev server on port 3000 at a time. `@frontend-chat` announces when it starts one in `tasks/review.md`. Coordinator also stops any running dev server before starting its own.

### Supabase local

Only one local Supabase stack (ports 54321/54322/etc.) at a time. `@infra-platform` owns it; other specialists `supabase status` to check and do not start their own.

### Nango local

Docker compose is `@infra-platform`'s to start/stop. Others connect to it.

### Task-board write conflicts

Specialists change status on their *own* tasks in their own worktree, commit, push, PR. The coordinator merges. Nobody else touches `todo.md` structure. This avoids hot-file conflicts on `main`.

### Model spend

Five agents running in parallel multiply OpenRouter costs ~5×. The per-household budget applies to *application-level* model usage, not agent-developer usage. Watch the OpenRouter dashboard. If spend surprises you, pause stage 3 and run 1+2 only.

### Claude Code account concurrency

If your Claude plan has a concurrency cap, five simultaneous sessions may exceed it. If agents stall or get rate-limited, reduce to 1+2 or 1+2+one specialist at a time.

## Killing the session safely

```
cmux kill-session -t homehub
```

Before doing this, confirm each specialist is not mid-PR. Killing mid-edit won't corrupt the repo (all changes are on their branches), but you may lose an in-flight commit message.

To remove a worktree cleanly:

```
# from the main repo:
git worktree remove ../homehub-worktrees/<agent>
git branch -d agent/<agent>    # only if merged; otherwise leave it
```

Never `rm -rf` a worktree directory — use `git worktree remove` so git's metadata stays consistent.

## Resuming

Each specialist's steady-state prompt (see README.md) just tells them to check `tasks/todo.md` and pick up. There's no "save-state" to worry about — git is the save state.

## Escalation

If a specialist gets stuck in a loop (repeated failed tool calls, spec ambiguity it can't resolve), it should write to `tasks/review.md` under `## DECISION NEEDED — <title>` and stop. The coordinator triages; if the coordinator can't resolve it against the spec, the coordinator escalates to the human by marking it blocked in `tasks/todo.md` and noting it in `review.md`.

## What a human should do daily

1. Skim `tasks/review.md` — last ~20 lines. Decisions made, things that need you.
2. `gh pr list --repo cnnrobrn/homehub` — anything stale?
3. Any `## DECISION NEEDED` entries in `review.md`? Resolve them by replying to the coordinator.
4. If cost/concurrency looks off, drop a stage.

Everything else should run itself.
