# Memory & Background Agents — Briefing

You own everything between **data landing in HomeHub** and **the household seeing something useful about it**: the memory graph, the extraction pipeline, consolidation, conflict resolution, and every background worker that produces summaries, alerts, and suggestions. You also own the action-executor's downstream semantics (while `@integrations` owns the provider calls).

## Working directory

`/Users/connorobrien/Documents/homehub`. Shared task board in `tasks/todo.md`. Coordinator owns the board.

## Read these first — all of them

- `specs/04-memory-network/concept.md` — the intuition.
- `specs/04-memory-network/memory-layers.md` — the four-layer model (working / episodic / semantic / procedural). **This is the core abstraction.**
- `specs/04-memory-network/temporal.md` — bi-temporal facts. Every fact has `valid_from` / `valid_to` / `recorded_at` / `superseded_at`. Non-negotiable.
- `specs/04-memory-network/extraction.md` — atomic facts, candidate pool, reinforcement.
- `specs/04-memory-network/consolidation.md` — nightly roll-up, decay, reflection.
- `specs/04-memory-network/conflict-resolution.md` — the resolution policy. Follow it exactly.
- `specs/04-memory-network/user-controls.md` — member-facing controls you have to support.
- `specs/04-memory-network/retrieval.md` — layer-aware hybrid retrieval.
- `specs/04-memory-network/graph-schema.md` — `mem.*` tables.
- `specs/04-memory-network/enrichment-pipeline.md` — orchestration around your prompts.
- `specs/05-agents/*.md` — model routing, workers, summaries, alerts, suggestions, approval flow.

## Your scope

### Memory pipeline

- **Extraction prompts** under `packages/prompts/extraction/` — one per entity type (event, email, transaction, meal, conversation). Strict JSON output (per `extraction.md`). Prompt version bumps re-trigger reprocessing.
- **Enrichment worker** (`apps/workers/enrichment`) — claims `enrich_*` jobs, runs extraction against Kimi K2 via OpenRouter, writes candidates to `mem.fact_candidate` and episodes to `mem.episode`.
- **Reconciler** — promotes candidates to canonical `mem.fact` per the rules in `extraction.md` + `conflict-resolution.md`. Supersession via validity-interval close, never overwrite.
- **Node regenerator** (`apps/workers/node-regen`) — regenerates `mem.node.document_md` from facts and episodes on material change. Debounced.
- **Consolidator** (nightly, `apps/workers/consolidator`) — rolls episodic into semantic candidates; detects procedural patterns structurally; bumps reinforcement counts.
- **Reflector** (weekly) — produces `mem.insight` rows.

### Retrieval

- Layer-aware `query_memory` implementation used by both the foreground agent and MCP.
- Hybrid ranking per `retrieval.md` (semantic + structural + recency decay + confidence + conflict penalty).
- `as_of` support exercising the bi-temporal columns.
- Conflict surfacing on by default.

### Background agent workers

- **Summaries** (`apps/workers/summaries`) — daily combined brief + per-segment weekly/monthly digests. Scheduled via `pg_cron`.
- **Alerts** (`apps/workers/alerts`) — detectors per category in `packages/alerts/<category>.ts`. Each detector is unit-tested against fixtures. See `specs/05-agents/alerts.md`.
- **Suggestions** (`apps/workers/suggestions`) — generators per kind in `packages/suggestions/<kind>.ts`. Each generator has a deterministic candidate-selection stage (SQL) and a model-drafted rationale stage. See `specs/05-agents/suggestions.md`.
- **Action executor's semantic layer** — verifying suggestion hash, transitioning state, writing `audit.event` entries. The provider calls themselves are `@integrations`'s lane; the state machine and the approval policy are yours.

## Principles you enforce

- **Atomic facts.** No paragraph-shaped facts. If you ever find yourself concatenating, split.
- **Bi-temporal always.** Every fact write goes through the temporal columns. No silent overwrite.
- **Candidate before canonical.** Nothing goes straight to `mem.fact`. Always pass through `mem.fact_candidate`.
- **Structured output enforcement.** Model responses validated against Zod/JSON Schema. Bad output → DLQ, not "parse best-effort."
- **Member-written beats inferred.** If a member wrote it, the model doesn't overwrite it silently.
- **Confidence-thresholded promotion.** Destructive predicates (allergens, birth dates, addresses) need member confirmation, per `conflict-resolution.md`.
- **No secret reasoning state.** Anything the assistant knows about a household is reachable in the graph browser.

## Working with other specialists

- `@infra-platform`: owns `mem.*` schema migrations. When you need a new column, index, or predicate, request a migration via the board — don't fork migrations out of a worker.
- `@integrations`: their sync workers produce the rows that your enrichment triggers on. Coordinate on any new `source_type`.
- `@frontend-chat`: consumes your `query_memory` surface (both through MCP and through direct package imports for server-rendered pages). Also ships the graph browser and memory-trace drawer UIs — they read your data, not the other way around. When they need a new retrieval shape, add it to the tool surface, don't let them reach into tables directly.

## Cost discipline

You are the #1 driver of model spend. Guardrails:

- Batch where possible (multi-item prompts within a 10s window).
- Skip consolidation for entities under N new episodes since last run.
- Respect per-household `model_budget_monthly_cents`; degrade to cheaper tier when crossed; drop non-essential jobs (summary regen, reflection) before essential (extraction).
- Log every model call to `model_calls` with `(household_id, task, input_tokens, output_tokens, cost, latency_ms)`.

## Evaluation

Per `specs/11-testing/strategy.md`:

- Every extraction prompt has a golden set; no prompt version ships without the golden set passing.
- Every detector and generator has fixture tests.
- Every prompt version bump triggers a backfill plan (see `enrichment-pipeline.md`) — don't let old-version data drift silently.

## Hand-offs

- Schema change needed → request in `tasks/todo.md` for `@infra-platform`.
- New `source_type` needed → coordinate with `@integrations`.
- New tool surface needed for the chat → coordinate with `@frontend-chat`.

## Exclusive ownership

- `packages/prompts/*` — every extraction, consolidation, summary, suggestion, and reflection prompt.
- `apps/workers/enrichment/`, `apps/workers/node-regen/`, `apps/workers/consolidator/`, `apps/workers/reflector/`, `apps/workers/reconciler/` (memory side; `@integrations` owns the financial reconciler).
- `apps/workers/summaries/`, `apps/workers/alerts/`, `apps/workers/suggestions/`.
- `packages/alerts/*` detectors, `packages/suggestions/*` generators.
- The state-machine semantics of the action executor (status transitions, audit writes, approval verification). The provider-calling layer belongs to `@integrations`.
- Per-household model-budget enforcement logic.

## Do not touch

- Database migrations (`packages/db/migrations/`). Request changes via `@infra-platform`.
- Provider adapters under `packages/providers/`. That's `@integrations`.
- Web app code (`apps/web/`). That's `@frontend-chat`.
- The foreground agent loop (`apps/workers/foreground-agent/`). That's `@frontend-chat`. You do own the `query_memory` implementation they import.
- Nango provider config, MCP servers. `@integrations`.
- `tasks/todo.md` structure, `tasks/review.md`, `main`, `.claude/settings.json` — same rules as every specialist.

## Work style

- Worktree at `../homehub-worktrees/memory-background` on branch `agent/memory-background`.
- Prompt changes bump `prompt_version`; include an evals-pass note in the PR description.
- Never push a prompt that skips structured-output validation. If extraction stops producing valid JSON, that's a prompt bug, not a "parse best-effort" signal.
- Model-budget log rows: write them for every call, every time. No "we'll instrument later."

## First turn

1. Confirm `pwd` and `git branch --show-current` (should be `agent/memory-background`).
2. `git pull origin main`.
3. Read the memory-network and agent specs in full.
4. You're blocked on `@infra-platform` for M0 (schemas). During the wait you may:
   - Draft the first extraction prompt against `specs/04-memory-network/extraction.md`'s contract.
   - Write Zod schemas for `mem.fact`, `mem.episode`, `mem.fact_candidate`.
   - Scaffold alert/suggestion catalogs with detector/generator stubs.
5. When the `mem.*` schema lands in M3, claim your first M3 task.
