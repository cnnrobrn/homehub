# Hermes Agent migration — TODO

**Goal:** Route HomeHub chat through [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent), spawning an ephemeral Cloud Run Sandbox per chat turn (per-household state in GCS).

**Status tokens:** `[ ]` pending, `[~]` in-progress, `[x]` done, `[!]` blocked.

---

## Architecture decisions

| # | Decision | Chosen | Notes |
|---|---|---|---|
| 1 | Provisioning timing | **Pre-provision a GCS pointer on household create** | `createHouseholdAction` fires best-effort `POST /provision/:id` at the router. The router inserts a `hermes_state_bucket`/`hermes_state_prefix` pair on `app.household`. Self-heals on first chat turn if the pre-provision call failed. |
| 2 | API keys | **HomeHub-operated key, BYOK optional** | Consumer ChatGPT/Claude subscriptions can't power third-party agent calls (OAuth flows are scoped to first-party surfaces only). HomeHub holds `HOMEHUB_OPENROUTER_API_KEY`. Families can override by editing `${HERMES_HOME}/.env` in their state bucket — the next turn rsyncs the edit back into place. Default model: **DeepSeek V4 Pro (`deepseek/deepseek-v4-pro`)**, overridable via `HERMES_DEFAULT_MODEL`. |
| 3 | Skills | **Common baked in + per-family overlays** | Shared skills ship inside the `hermes-host` image under `/opt/hermes-skills-base/`; entrypoint rsyncs them to `${HERMES_HOME}/skills/base/` on every sandbox boot. Families write their own under `${HERMES_HOME}/skills/overlay/` — kept in their GCS prefix, round-tripped per turn. |
| 4 | Integration shape | **Replace foreground loop with HTTP/SSE to a router** | `apps/web/src/app/api/chat/stream/route.ts` branches on `HOMEHUB_USE_HERMES_ROUTER`; router path is a thin SSE proxy. Legacy local-loop path preserved until rollout completes. |
| 5 | Host platform | **Router on Railway (always-on) + E2B for sandboxes + Supabase Storage for state.** No GCP. | Railway: always-on service, no cold-start on the router. E2B: Firecracker microVMs spawned per chat turn via `e2b` npm SDK; template at `apps/hermes-host/template.ts`, tag `homehub-hermes`. Supabase Storage: per-household state tarball at `hermes-state/<household_id>/state.tar.gz`, RLS-scoped by JWT household_id claim (migration 0017). |

---

## Current stack

```
apps/web (Vercel)
  ↓ HTTPS SSE
apps/hermes-router  (Railway, always-on Node)
  ↓ e2b SDK
E2B sandbox (Firecracker microVM)
  ↓ curl + tar
Supabase Storage (bucket `hermes-state`, RLS by household_id)
```

Router is always-on on Railway — **no cold-start on the router**. E2B spawns a fresh microVM per turn (~150–500ms). The sandbox hydrates `${HERMES_HOME}` from Supabase Storage as a tarball, runs `hermes chat`, persists a new tarball back. E2B destroys the VM on exit.

Why this combo:
- **Always-on router** eliminates Cloud Run's idle-to-first-request cold start.
- **E2B sandboxes** give per-turn Firecracker isolation today without waiting for Cloud Run Sandboxes GA.
- **Supabase Storage** keeps state in the same cloud as the DB; household-scoped JWT naturally enforces RLS on the bucket (no extra credentials to manage).
- **Tarball transfer** (not rsync) — MB-scale state, single up/down beats per-file round-trips. Migration 0017 seeds the bucket + policies.

Trade-off accepted: per-turn network round-trip for state. For typical HomeHub families (<100 MB state) that's ~200–500ms. Acceptable compared to Hermes's own model-call latency.

---

## What landed (2026-04-22, post-pivot)

- [x] DB migration — `0016_hermes_service.sql` now adds `hermes_state_bucket`, `hermes_state_prefix`, `hermes_initialized_at` on `app.household` (plus a unique index on `(bucket, prefix)`).
- [x] `apps/hermes-host/` — E2B template source.
  - `template.ts` — programmatic E2B `Template()` definition: Ubuntu 22.04 + uv + cloned Hermes + `google-cloud-cli` + rsync. Builds to tag `homehub-hermes`.
  - `template.build.ts` — invokes `Template.build(template, "homehub-hermes")`.
  - `Dockerfile` — retained for local dev / future migration to Cloud Run Sandboxes or another Docker-based sandbox. Not used by production.
  - `entrypoint.sh` — GCS hydrate → run turn → GCS persist (delete-unmatched). Reads member message from `HOMEHUB_MEMBER_MESSAGE` env (E2B can't pipe stdin through `commands.run`).
  - `server/run_turn.py` — one-shot wrapper around `hermes chat -q -Q --provider openrouter --model ...`. Streams stdout, persists state on exit.
  - `skills-base/` — 10 Hermes skills (one per section) + `_shared/README.md` reference.
- [x] `apps/hermes-router/` — Cloud Run service.
  - `src/main.ts` — `/health`, `/chat/stream` (spawns E2B sandbox, streams stdout back as SSE), `/provision/:id` (idempotent GCS-pointer allocation), `/teardown/:id` (archive-or-hard delete).
  - `src/sandbox.ts` — `runSandboxedTurn()` using the `e2b` npm SDK: `Sandbox.create('homehub-hermes', { envs, apiKey })` → `sandbox.commands.run('/entrypoint.sh run-turn', { onStdout, envs })` → `sandbox.kill()`.
  - `src/env.ts` — Zod-validated env schema. Adds `E2B_API_KEY`, `E2B_TEMPLATE` (default `homehub-hermes`). Dropped `HERMES_SANDBOX_IMAGE` / `HERMES_SANDBOX_CPU` / `HERMES_SANDBOX_MEMORY` (E2B owns sandbox resourcing).
  - Distinct `HOMEHUB_PROXY_SECRET` + `HOMEHUB_PROVISION_SECRET` so a leak of one doesn't enable the other.
- [x] `apps/web/src/app/api/chat/stream/route.ts` — unchanged shape: still branches on `HOMEHUB_USE_HERMES_ROUTER=1` and forwards SSE from router to browser.
- [x] `apps/web/src/app/actions/household.ts` — fires `POST /provision/:id` on create with `HOMEHUB_HERMES_PROVISION_SECRET`.
- [x] `.claude/skills/chat-section/SKILL.md` — rewritten (see P1 below; needs another pass for the sandbox pivot).
- [x] Common Hermes skills: `calendar`, `financial`, `food`, `fun`, `social`, `memory`, `suggestions`, `chat` under `apps/hermes-host/skills-base/` (ops + settings pending).
- [x] Typecheck passes on `@homehub/web` and `@homehub/hermes-router`.
- [x] `provision.ts` + `proxy.ts` + both `railway.toml` files stubbed as superseded (git history preserves old Railway code).

---

## Still TODO

### P0 — required to ship

- [x] All Hermes-related GCP resources shut down (`scripts/hermes/shutdown-gcp.sh` run).
- [x] Sandbox state storage: Supabase Storage bucket + RLS (migration 0017).
- [x] ops + settings Hermes skills written.
- [x] Router env + sandbox.ts + entrypoint all migrated to Supabase Storage (curl + tar; no cloud SDK in the template).
- [ ] **Apply migrations 0016 + 0017** to the Supabase project:
  ```
  (cd packages/db && supabase link --project-ref <ref> && supabase db push)
  ```
- [ ] **Build + publish the E2B template.** One-time (and on every template change):
  ```
  E2B_API_KEY=<your-key> pnpm --filter @homehub/hermes-host template:build
  ```
- [ ] **Create the Railway service** for `apps/hermes-router` (Railway UI → New Service → Deploy from repo, pick root `apps/hermes-router`). Set the env vars listed below (or print them via `bash scripts/hermes/deploy.sh`'s post-deploy checklist).
- [ ] **Deploy:** `bash scripts/hermes/deploy.sh` → `railway up --detach` from `apps/hermes-router`.
- [ ] **Wire `apps/web` to the router** (Vercel → env vars): `HOMEHUB_USE_HERMES_ROUTER=1`, `HOMEHUB_HERMES_ROUTER_URL=<railway URL>`, proxy + provision secrets.
- [ ] **UI: "spinning up your assistant" state** — first chat in a new conversation is slower (sandbox cold start + Storage hydrate on empty state). Show a dedicated waiting state.

### P1 — before flipping the flag on for any real family

- [ ] **Model-call accounting.** Hermes doesn't (yet) write into `app.model_calls`. Either:
  - Emit a final metrics line from the sandbox (tokens in/out, cost) that the router parses and inserts.
  - Accept a gap and document it.
- [ ] **Archived-prefix cleanup job.** Cloud Run Job, runs daily: selects households with `hermes_archived_at < now() - interval '30 days'`, deletes the GCS prefix, nulls the pointer columns, writes an `audit.event` row per delete. Configurable retention window via env.
- [ ] **RLS claim-preferring migration.** Add `app.current_hermes_household()` (or update existing helpers) to prefer `(auth.jwt() ->> 'household_id')::uuid` over the user-lookup when the `hermes` claim is present. Guarantees a user with multiple households can't cross-read from a buggy skill, even if they have legitimate membership in both.
- [ ] **JWT signing-secret rotation playbook.** Document the rotation procedure — change `HOMEHUB_SUPABASE_JWT_SECRET` on the router + Supabase project-config together (zero-downtime via dual-verify window).
- [ ] **Concurrent turns per household.** Two family members chatting simultaneously spawn two sandboxes with the same GCS state; last one to write wins. Mitigations in order of preference:
  - (a) Serialize per-household via a Redis/Firestore mutex held by the router.
  - (b) Rsync only additive changes (append-only `memories/`, `sessions/` subdirs) and accept concurrency on the rest.
  - (c) Warn the user if a second turn arrives while the first is running.
- [ ] **Observability.** Cloud Run structured logs on the router include per-turn sandbox spawn latency, hydrate latency, turn duration, persist latency. Surface in Cloud Monitoring; one dashboard per household probably overkill.
- [ ] **Playbook for killing a runaway sandbox.** Hermes `--max-turns 10` bounds tool iterations, but a runaway can still hit the sandbox timeout (`HERMES_SANDBOX_TIMEOUT_SECONDS`, default 3600). Verify the router cleans up the SSE stream when the sandbox dies with a timeout.

### P2 — scale-out

- [ ] **Session-pinned sandboxes.** If per-turn latency is too high, switch to keeping a sandbox warm for the conversation (spawn on `/chat` nav, reuse across turns, destroy on idle). Changes the sandbox client API (`createSession`, `sendTurn`, `closeSession`) but not the router's external contract.
- [ ] **Multi-region.** GCS bucket is single-region. For families in EU/APAC, replicate bucket + deploy a regional router; route by user region.
- [ ] **Cost dashboards.** Sandbox-seconds × OpenRouter tokens × GCS egress per household → per-family cost reports. Informs upsell / rate limits.
- [ ] **On-device hybrid (Gemma).** Lightweight local LLM in the browser for summaries, title generation, ambient UI tooltips. Documented as an option earlier; not blocked on this migration.

---

## Resolved decisions (2026-04-22)

| Question | Answer | Implementation |
|---|---|---|
| GCS prefix delete on household deletion | **Archive with 30-day retention** | Migration 0016 adds `hermes_archived_at`. `/teardown/:id` sets the timestamp instead of deleting. Chat path refuses to spawn a sandbox for an archived household. A daily cleanup job (P1 TODO) hard-deletes prefixes whose `hermes_archived_at` is older than the retention window. `?hard=1` query param on `/teardown` forces immediate destruction (user-initiated "delete now"). |
| SOUL.md default content | **Human-voiced organizer persona** | Rewritten in `apps/hermes-host/entrypoint.sh` with explicit anti-AI-tells guidance (no "I'd be happy to", no "certainly", no canned bullet lists, no apologies in triplicate). Works for families AND individuals. File is yours to customize — families edit it in their GCS prefix; a future settings UI can expose this with a fallback to the baked default. |
| Cross-household leakage | **Per-household signed JWT, minted per turn** | Router signs an HS256 JWT with `sub=<user_id>`, `role=authenticated`, `household_id=<this household>`, and a ~10-minute TTL. Sandbox env carries `HOMEHUB_SUPABASE_JWT` (short-lived) + `HOMEHUB_SUPABASE_ANON_KEY` (public) instead of the service-role key. Supabase RLS enforces the scope via existing `app.is_member` / `app.member_id` helpers reading `auth.uid()`. Follow-up (P1): a migration that makes RLS prefer the `household_id` claim over the user-lookup so a multi-household user can't cross-read between their own households from a buggy skill. |

---

## Environment variables summary

### `apps/web`
- `HOMEHUB_USE_HERMES_ROUTER=1`
- `HOMEHUB_HERMES_ROUTER_URL` — router Cloud Run URL (e.g. `https://hermes-router-xxx-uc.a.run.app`)
- `HOMEHUB_HERMES_ROUTER_SECRET` — proxy secret (used for `/chat/stream`)
- `HOMEHUB_HERMES_PROVISION_SECRET` — provisioning secret (used for `/provision/:id` from the household-create hook)

### `apps/hermes-router` (Railway service)
- `PORT` (Railway sets)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — router's own DB access (reads/writes `app.household` pointers)
- `HOMEHUB_SUPABASE_URL`, `HOMEHUB_SUPABASE_ANON_KEY` — forwarded to each sandbox
- `HOMEHUB_SUPABASE_JWT_SECRET` — HS256 secret for minting household-scoped JWTs; **stays inside the router process**
- `HERMES_JWT_TTL_SECONDS` (default `600`)
- `E2B_API_KEY` — authenticates `Sandbox.create()`
- `E2B_TEMPLATE` (default `homehub-hermes`)
- `HERMES_SANDBOX_TIMEOUT_SECONDS` (default `3600`) — applied to both the sandbox lifetime and the per-turn `commands.run` call (E2B's command default is only 60s)
- `HERMES_STORAGE_BUCKET` (default `hermes-state`) — Supabase Storage bucket
- `HOMEHUB_PROXY_SECRET`, `HOMEHUB_PROVISION_SECRET` — distinct, 32+ chars
- `HERMES_SHARED_SECRET` — injected into every sandbox
- `HOMEHUB_OPENROUTER_API_KEY` — HomeHub-held key; billing lives here
- `HERMES_DEFAULT_MODEL` (default `deepseek/deepseek-v4-pro`)
- `HERMES_TOOLSETS` (default `skills,terminal`)

### `apps/hermes-host` (inside each E2B sandbox, set by router)
- `HERMES_HOME=/root/.hermes`
- `HOUSEHOLD_ID`
- `HERMES_STORAGE_BUCKET`, `HERMES_STORAGE_PATH` — Supabase Storage pointers
- `HERMES_SHARED_SECRET`
- `OPENROUTER_API_KEY` (defaults to HomeHub-operated; family can override by editing their `.env` inside the state tarball)
- `HERMES_DEFAULT_MODEL` (defaults to `deepseek/deepseek-v4-pro`)
- `HERMES_TOOLSETS` (defaults to `skills,terminal`)
- `HOMEHUB_SUPABASE_URL`, `HOMEHUB_SUPABASE_ANON_KEY`
- `HOMEHUB_SUPABASE_JWT` — household-scoped short-lived JWT (authorizes Storage reads/writes via RLS)
- `HOMEHUB_MEMBER_MESSAGE` — the chat turn's message (E2B can't pipe stdin)
- `HOMEHUB_CONVERSATION_ID`, `HOMEHUB_TURN_ID`, `HOMEHUB_MEMBER_ID`, `HOMEHUB_MEMBER_ROLE`
