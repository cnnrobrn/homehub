# HomeHub — cmux Agent Orchestration

This directory holds the briefings the `scripts/cmux-launch.sh` script loads into cmux windows. Five windows, five briefings:

| Window              | Briefing                      | Role                                            |
|---------------------|-------------------------------|-------------------------------------------------|
| `coordinator`       | `coordinator.md`              | Owns the plan, the board, and review            |
| `infra-platform`    | `infra-platform.md`           | Monorepo, Supabase, auth, Nango deployment, queues, runtime |
| `integrations`      | `integrations.md`             | Nango provider configs, MCP, sync workers       |
| `memory-background` | `memory-background.md`        | Memory pipeline + background agent workers     |
| `frontend-chat`     | `frontend-chat.md`            | Next.js UI + first-party chat + agent loop      |

## How coordination works

- **Shared board:** `tasks/todo.md` at the repo root. Only the coordinator writes to it; specialists read it and claim tasks by moving them to `in-progress`, then `ready-for-review` when done.
- **Decision log:** `tasks/review.md`. The coordinator logs reviews, decisions, and open decisions that need human input.
- **Spec tree:** `specs/` is the source of truth for *what* to build. Briefings tell each agent *which* parts of the spec to care about.
- **No direct agent-to-agent chat.** Specialists don't talk to each other. If one needs something from another, it goes on the board as a task owned by the other, with the requester noted.

## How to run

Staged launch — see [`OPERATIONS.md`](./OPERATIONS.md) for the full runbook.

```bash
./scripts/cmux-launch.sh 1     # stage 1: coordinator only
./scripts/cmux-launch.sh 2     # stage 2: add infra-platform
./scripts/cmux-launch.sh 3     # stage 3: add integrations, memory-background, frontend-chat
```

The script:

1. Creates a cmux session named `homehub` (override via `SESSION_NAME=`).
2. Opens one window per agent, each running `claude` with the corresponding briefing as the initial prompt.
3. For specialists: sets up a git worktree at `../homehub-worktrees/<agent>/` on branch `agent/<name>`, and sets the window's cwd there so they cannot accidentally edit `main`.
4. Leaves the session detached. Attach with `cmux attach -t homehub`.

### Environment knobs

| Variable        | Default           | Meaning                                                |
|-----------------|-------------------|--------------------------------------------------------|
| `SESSION_NAME`  | `homehub`         | cmux session name                                      |
| `CMUX_BIN`      | `cmux`            | Path/name of the cmux binary                           |
| `CLAUDE_BIN`    | `claude`          | Path/name of the Claude Code CLI                       |
| `CLAUDE_FLAGS`  | `--permission-mode acceptEdits` | Flags passed through to Claude Code  |

## Adjusting cmux syntax

`scripts/cmux-launch.sh` tries a common flag pattern first and falls back to a tmux-style `new-window` + `send-keys` pattern. If your cmux takes a different shape (e.g., a YAML session config, or `cmux run` with a profile), edit the `CMUX_NEW_WINDOW` helper in the script and leave the rest as-is. The agent briefings are unaffected.

## Changing the division

The five-agent split is deliberate — it matches the spec tree's natural seams (infra/integrations/memory/frontend) with a coordinator on top. If you reshape the team:

- Keep exactly one coordinator. Rotating the role or running two concurrently creates board write-conflicts.
- Don't split memory from background agents. They share the model-budget and prompt-version discipline; splitting them across agents produces drift.
- Don't merge integrations with infra-platform. The threat-model separation (token handling on one side, service role keys on the other) is easier to keep clean when the humans / agents are separate.

## Safety rails

Baked into the briefings:

- No agent may push to `main` directly — coordinator-approved PRs only.
- No agent may run destructive ops (force-push, reset --hard, branch delete) without explicit human approval.
- Any spec change goes through a spec-file edit *before* any code change that depends on it.

The coordinator's job includes catching violations in review.
