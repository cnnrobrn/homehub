---
name: chat-section
description: Populate data and add tabs/functionality in the Chat section (/chat). Use when the user wants to seed conversations/turns, add a new chat tab (e.g. archive, saved, threads), change how chat routes to the Hermes Agent backend (router + E2B sandboxes), add a Hermes skill, or seed demo chat state. The chat backbone is Nous Research's Hermes Agent (github.com/NousResearch/hermes-agent) spawned inside ephemeral E2B Firecracker microVMs, one per chat turn, with per-household state in GCS. (When Google's Cloud Run Sandboxes GA, swap `apps/hermes-router/src/sandbox.ts` — same shape.)
---

# Chat section

The conversation surface plus its backend: Nous Research's **Hermes
Agent**. Each chat turn spawns a fresh **E2B Firecracker microVM**
(ephemeral, strong isolation), hydrates the family's state from GCS,
runs `hermes chat`, streams stdout back, and persists state on exit.
Migration target: Google Cloud Run Sandboxes when they GA — same
architectural shape, one-file swap in `sandbox.ts`.

## Surface area

- Route root: `apps/web/src/app/(app)/chat/` —
  `page.tsx`, `new/`, and `[conversationId]/page.tsx`.
- Stream route handler: `apps/web/src/app/api/chat/stream/route.ts`.
  Two possible backends, selected by `HOMEHUB_USE_HERMES_ROUTER`:
  - `=1` → proxies SSE to `apps/hermes-router` (production path).
  - unset → legacy local foreground-agent loop
    (`@homehub/worker-foreground-agent`) — preserved for transition.
- **hermes-router** (`apps/hermes-router/`, Cloud Run service, always-on).
  `/health`, `/chat/stream`, `/provision/:id`, `/teardown/:id`.
  Spawns Cloud Run Sandboxes via `src/sandbox.ts` (`runSandboxedTurn`).
  Owns the HomeHub-operated `HOMEHUB_OPENROUTER_API_KEY` + distinct
  proxy and provision secrets.
- **hermes-host** (`apps/hermes-host/`). E2B template, published under
  tag `homehub-hermes` via `Template.build()` in `template.build.ts`.
  - `template.ts` — Ubuntu 22.04 + uv + cloned Hermes + `google-cloud-cli`.
  - `entrypoint.sh run-turn` — GCS hydrate → run turn → GCS persist.
  - `server/run_turn.py` — one-shot wrapper: reads `HOMEHUB_MEMBER_MESSAGE`
    env (E2B can't pipe stdin), runs `hermes chat -Q --provider openrouter
--model ... --continue homehub-<conv_id> --max-turns 10 --yolo -q <msg>`,
    streams stdout, persists state on exit.
  - `skills-base/` — baked common HomeHub skills (one per section).
    Refreshed into `${HERMES_HOME}/skills/base/` on every sandbox boot;
    per-family overlays in `${HERMES_HOME}/skills/overlay/` survive.
  - **Build:** `E2B_API_KEY=... pnpm --filter @homehub/hermes-host template:build`.
    Run on first setup and every template change.
- Data tables (migration
  `packages/db/supabase/migrations/0008_conversation.sql`):
  `app.conversation`, `app.conversation_turn`,
  `app.conversation_attachment`.
  Household pointers (migration `0016_hermes_service.sql`):
  `hermes_state_bucket`, `hermes_state_prefix`, `hermes_initialized_at`.
- Provisioning: `createHouseholdAction` fires best-effort
  `POST {HOMEHUB_HERMES_ROUTER_URL}/provision/<household_id>` on
  create; router allocates a GCS prefix (`household/<id>/<uuid>`) and
  writes it back.

## Populate data

1. **Local dev seed (SQL)** — append to
   `packages/db/supabase/seed.sql`. Seed a `app.conversation` and a few
   `app.conversation_turn` rows alternating `role='member'` /
   `role='assistant'`.
2. **Real turn via sandbox** — `POST /api/chat/stream`; apps/web
   persists the member turn, then forwards to the router. Router
   allocates the GCS pointer if missing, spawns an E2B sandbox with
   the family's env, runs Hermes, streams stdout back as SSE,
   persists state to GCS.
3. **New agent capability** — two options:
   - **Hermes skill** (runtime for the family): add a directory under
     `apps/hermes-host/skills-base/<name>/SKILL.md` with the upstream
     frontmatter (`name`, `description`, `version`, `metadata.hermes`).
     Rebuild the image and push to Artifact Registry. Every new
     sandbox boot picks it up. Families pick it up on their next turn.
   - **Per-family skill**: the family edits
     `${HERMES_HOME}/skills/overlay/<name>/SKILL.md` in their GCS prefix.
     Rsync'd back on the next turn's persist step.

## Add a tab

1. Create `apps/web/src/app/(app)/chat/<tab>/page.tsx` (e.g.
   `/chat/archive`).
2. Introduce `apps/web/src/components/chat/ChatSubNav.tsx` (model on
   `FinancialSubNav.tsx`) and render from a new `chat/layout.tsx`.
3. Guard the `[conversationId]` route so it stays the canonical
   threaded view.

## Gotchas

- **Router feature flag**: `HOMEHUB_USE_HERMES_ROUTER=1` needs
  matching `HOMEHUB_HERMES_ROUTER_URL`, `HOMEHUB_HERMES_ROUTER_SECRET`
  (proxy), and `HOMEHUB_HERMES_PROVISION_SECRET` (provision). Mixing
  secrets will 401.
- **First-turn latency**: empty GCS state hydrates quickly, but
  sandbox cold start + `hermes chat` boot dominates. First turn in a
  new conversation can take several seconds. Show a dedicated
  "spinning up" UI state.
- **Concurrent turns per household** race on GCS state. Two members
  chatting in parallel: last rsync wins. Mitigations in P1 of
  `tasks/hermes/todo.md` (serialize per-household via mutex, or
  use additive-only subdirs).
- **API key model**: default is a **HomeHub-operated**
  `OPENROUTER_API_KEY` (router injects the same value into every
  sandbox). Consumer ChatGPT/Claude subscriptions cannot power
  third-party agent calls. Families can override by editing
  `${HERMES_HOME}/.env` in their GCS prefix — the next turn's persist
  preserves it, and subsequent hydrates read the override. Never log
  the key in router or host; never ship it back to apps/web.
- **Default model**: `moonshotai/kimi-k2.6` (Kimi 2.6, strong
  tool-use). Settable via `HERMES_DEFAULT_MODEL` at router env level
  or per-family in their GCS `.env`.
- **Cross-household leakage**: skills use service-role Supabase,
  which bypasses RLS. Every query MUST include
  `household_id=eq.$HOUSEHOLD_ID`. See
  `apps/hermes-host/skills-base/_shared/README.md` for the hard rules.
- **Model-call accounting**: `app.model_calls` was populated by the
  legacy loop. With the sandbox path, Hermes owns the metrics — we
  either parse a final-line from sandbox stdout and insert, or accept
  a gap. Decide before flipping the flag in prod (see P1 TODO).
- The legacy `apps/workers/foreground-agent` stays in the repo until
  every household is on the sandbox path.
