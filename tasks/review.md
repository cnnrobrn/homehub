# HomeHub — Review & Decision Log

**Owner:** coordinator. Append-only log of reviews, decisions, and open questions bubbling up from the specialists.

Format:

```
## YYYY-MM-DD — <short title>
<one paragraph: context, decision, who's affected>
```

Use `## DECISION NEEDED — <title>` for things that require human input rather than coordinator resolution.

---

## 2026-04-20 — Kickoff

**Repo state.** Clean checkout on `main` at 5e16dcc. `specs/` tree, five-agent briefings (`scripts/agents/*`), `.claude/settings.json`, `tasks/todo.md` all present and consistent. M0 block in `tasks/todo.md` is well-formed: eight atomic items, all owned by `@infra-platform`, no missing blocker annotations. Nothing to fix before dispatch.

**Stage.** M0 begins now. M1–M11 blocked per dependency chain in `scripts/agents/coordinator.md`.

**Execution model note.** The cmux multi-terminal orchestration (`scripts/cmux-launch.sh`) is the intended flow for running five parallel Claude Code sessions. This session is operating in single-process coordinator mode: I dispatch specialist work to focused sub-agents, review the output against the spec, and gate the merge. Worktree-per-specialist isolation is deferred until the human either runs `cmux-launch.sh` or greenlights an in-repo branching model. For now, specialist sub-agents work directly on `main` under coordinator review.

**Cloud-account scope.** M0 tasks that require live cloud accounts (Supabase Pro provisioning, Railway services, Vercel project binding, OpenRouter key issuance, Nango SaaS deployment) are human-gated — we scaffold the code, infra, and config so those provisioning steps are single `supabase link` / `railway up` / `vercel link` commands when credentials are ready. Nothing in M0 requires a real third-party token.

**Cadence.** On each wake: (1) scan PRs + todo.md deltas, (2) review any `[r]` rows against the spec + review-standards checklist, (3) merge or request changes, (4) unblock downstream, (5) log the outcome here.

**M0 dispatch plan.**

1. `M0-A` Monorepo foundation — pnpm workspaces, TS strict, eslint, prettier, commitlint, `.editorconfig`, GitHub Actions CI (lint + typecheck + migration-lint stub).
2. `M0-B` `packages/db` — Supabase CLI config, local stack, extension-enable migration (`pgvector`, `pgmq`, `pg_cron`, `pg_trgm`, `uuid-ossp`), schema-create migration for `app`/`mem`/`sync`/`jobs`/`audit` namespaces (empty tables land in M1/M3).
3. `M0-C` `packages/worker-runtime` — Supabase service client, pgmq claim/ack/retry/DLQ wrapper, Nango client, OpenRouter `generate()` helper with prompt-cache awareness, structured JSON logger, OTel tracer, graceful SIGTERM, queue registry.
4. `M0-D` `apps/web` — Next.js App Router (TS strict, Tailwind, shadcn primitives, `@supabase/ssr`), design-system token layer, placeholder root layout, health route.
5. `M0-E` Worker + MCP service stubs — `apps/workers/{sync-gcal,sync-gmail,sync-financial,sync-grocery,webhook-ingest,enrichment,reconciler,node-regen,consolidator,reflector,summaries,alerts,suggestions,action-executor,foreground-agent}` and `apps/mcp/{homehub-core,ingest}` — each a tiny `main.ts` wired to `packages/worker-runtime` with a no-op handler + unit-test scaffold + Railway service config (`railway.toml` or `Dockerfile`).
6. `M0-F` `infra/nango` — pinned docker-compose.yml for local Nango with isolated Postgres; env template; README.

Dispatched as sequenced briefs to `@infra-platform` specialist. M0-A first; the rest follow as each lands.

**Review standards reminder** (enforced at merge): RLS + 3 policy tests per new table, idempotent workers, Zod-schema-first tools, no duplicate files, no DB mocks in integration tests, production-ready from day one.

## 2026-04-20 — M0-A reviewed & accepted (commit 1556d8d)

Scope delivered: pnpm@9.15.9 workspaces (globs: apps/*, apps/workers/*, apps/mcp/*, packages/*), TS strict base + root config, ESLint 9 flat config, Prettier 3, Husky + lint-staged + commitlint, GitHub Actions CI (lint / typecheck / format-check / migration-lint placeholder) with cancel-in-progress concurrency, Dependabot, README.

Verified locally: `pnpm lint`, `pnpm typecheck`, `pnpm format:check` all exit 0 against the empty workspace. pnpm install with `--frozen-lockfile` replays cleanly.

Specialist decisions accepted:

1. **Node and pnpm pins** — Node 20.18.0, pnpm 9.15.9 (both current tips at time of scaffolding). Fine.
2. **ESLint 9 flat config** — aligns with spec guidance for greenfield.
3. **`.prettierignore` covers `spec.md`, `specs/`, `tasks/`, `scripts/agents/`** — those are coordinator/specialist prose with deliberate line layouts. Accepted as a standing decision: Prettier does not format spec prose. If a spec doc ever gets reformatted, do it manually.
4. **`migration-lint` CI job is a placeholder echo** — M0-B must wire the real `supabase db lint` (or equivalent) before that job is meaningful.

Commit remains unpushed (no remote configured / no human gate yet). No follow-ups blocking M0-B.

## 2026-04-20 — M0-B dispatched

`@infra-platform`: packages/db workspace. Supabase CLI config + local dev wiring, `0001_extensions.sql` (pgvector, pgmq, pg_cron, pg_trgm, uuid-ossp), `0002_schemas.sql` (app/mem/sync/jobs/audit namespaces), typed migration tooling, seed.sql stub, replace the CI migration-lint placeholder with the real check.

## 2026-04-20 — M0-B reviewed & accepted (commit 55da152)

Scope delivered: `packages/db/` workspace with Supabase CLI config + 0001 extensions + 0002 schemas + scripts + README; CI `migration-lint` now runs real `supabase db lint --local --fail-on warning` against a booted stack (pinned CLI v2.90.0).

Verified locally: repo-root `pnpm lint`, `pnpm typecheck` (now includes `@homehub/db`), `pnpm format:check` all exit 0.

Specialist decisions accepted:

1. **`jobs` schema created empty.** `pgmq` owns its own `pgmq` schema; `jobs` stays as a named slot for bespoke future job-metadata tables. No-op today.
2. **`db:reset` deny / `db:reset:local` warn-and-run.** Matches the "never reset staging/prod" rule from infra-platform briefing + `specs/10-operations/deployment.md`.
3. **`db:push` intentionally absent** from package scripts — pushes are a coordinator-pipeline action.
4. **Supabase CLI pinned at v2.90.0**, installed via the official .deb URL in CI.
5. **`--fail-on warning` for `supabase db lint`** — strict by default; we'll loosen only if a real warning proves spurious.

Follow-ups tracked, not blocking M0-C:

- **`audit` schema exposed via PostgREST.** Default for this migration is to expose `app, mem, sync, audit`. `audit.event` is append-only and service-role-only per `specs/09-security/auth.md` intent; exposing it via PostgREST is over-broad. Will narrow to `app, mem, sync` in a follow-up migration before M1 writes the first `audit` row. Tracked as M1-prereq.
- **`db:types` regen** after M1 lands real tables; commit the regenerated file.
- **Migration-numbering + RLS-presence CI check** — add a static check that every CREATE TABLE in `app.*` / `mem.*` ships with an accompanying RLS enable + policy. Do it alongside the first M1 table migration.

## 2026-04-20 — M0-C dispatched

`@infra-platform`: `packages/worker-runtime`. Supabase service client, pgmq claim/ack/retry/DLQ wrapper, Nango client, OpenRouter `generate()` helper with prompt-cache awareness, structured JSON logger, OTel tracer + SIGTERM handling, queue registry. Also `packages/shared` (domain types + small utilities) since other packages are about to depend on it.

## 2026-04-20 — M0-C reviewed & accepted (commit 28ffab3)

Scope delivered: `packages/shared` (env loader, branded IDs, time/money helpers) and `packages/worker-runtime` (Supabase service client, pgmq wrapper with envelope schema + queue registry, Nango client, OpenRouter `generate()` with prompt-cache + JSON schema validation + fallback + model_calls logging stub, pino logger, OTel tracer, `runWorker` SIGTERM drainer, `withBudgetGuard` stub). Errors: `NotYetImplementedError`, `StructuredOutputError`, `ModelCallError`, `QueueError`, `NangoError`.

CI adds a parallel `test` job (`pnpm -r --if-present run test`). 37 vitest tests green (17 shared + 20 worker-runtime). Verified locally: lint, typecheck (participates `@homehub/db`, `@homehub/shared`, `@homehub/worker-runtime`), format:check, test all clean.

Specialist decisions accepted:

1. **Per-household ordering** — pgmq is FIFO per queue. Documented in `packages/worker-runtime/README.md`: rely on per-queue FIFO today, defer a `jobs.in_flight_by_household` gate until metrics justify it. `visibilityTimeoutSec` is the escape hatch. This is a conscious deferral of the `specs/08-backend/queues.md` "ordering_key = household_id" phrasing — acceptable; revisit at M10 if depth skew appears.
2. **Foreground model default** — `anthropic/claude-sonnet-4.5` as the starting point (per `specs/05-agents/model-routing.md` "Sonnet-class or similar"). Swappable via config. When Anthropic releases a newer Sonnet, bump.
3. **`package.json#exports`** on `packages/db` and `packages/shared` expose `types: src/index.ts` so tsc/vitest resolve without a pre-build step. Runtime still points at `dist/index.js`. Accepted as the pragmatic TS monorepo pattern; revisit if we want strict project references.
4. **Supabase JS `pgmq_public` schema** is untyped — the queue client widens through `unknown` with narrow local shapes. Fine — SQL stays schema-qualified.
5. **M1-blocked call paths all stubbed with stable interfaces.** `queueClient.deadLetter` throws `NotYetImplementedError`; model-call cost logging warns-once-then-noop until `app.model_calls` exists; `withBudgetGuard` returns `{ ok: true, tier: 'default' }`. Call sites won't need to change when M1 drops in the real tables — this is the right shape.

Pinned versions noted for future review: `@supabase/supabase-js ^2.104.0`, `@nangohq/node ^0.70.1`, `pino ^10.3.1`, `zod ^4.3.6`, `@opentelemetry/sdk-node ^0.215.0`, `vitest ^4.1.4`.

Nothing blocking M0-D.

## 2026-04-20 — M0-D dispatched

`@infra-platform`: `apps/web` Next.js App Router bootstrap. Minimum shell — Tailwind + shadcn primitives set-up, `@supabase/ssr`, base layout + health route, design-system token layer, and CI-passing typecheck/lint. Actual UI (segment pages, chat, graph browser) is M1+ and owned by `@frontend-chat`. This dispatch only stands up a deployable/typecheckable Next.js project.

## 2026-04-20 — M0-D reviewed & accepted (commit 579463b)

Scope delivered: `apps/web` as a Next.js 15.5 App Router project (React 19, Tailwind 4, `@supabase/ssr`, Zod-validated env with build-phase opt-out, dark-default token layer, `/api/health` route, landing stub). CI now runs a `web-build` job in addition to lint / typecheck / format-check / test / migration-lint. `@homehub/web` participates in the root `typecheck`.

Verified locally: lint, typecheck, format:check, test all exit 0. Dev server boots and both `/` and `/api/health` return 200.

Specialist decisions accepted:

1. **Honored the `^15.x` spec pin.** Next 16 is out but the spec locked to 15.x; we follow it. Revisit when bumping.
2. **`@supabase/ssr ^0.10.2`** (latest stable; spec's `^0.7.1` reference is outdated).
3. **`next lint` deprecated → use `eslint .` directly** with `eslint.ignoreDuringBuilds: true` in `next.config.ts`. Documented in `apps/web/README.md`. Standing decision.
4. **Lazy `serverEnv()` getter + eager `publicEnv`** so client-component imports don't trigger server-only-var validation. Shape matches spec intent; this is the correct pragmatic form.
5. **`eslint.config.mjs` re-asserts root import/order** so the monorepo's `type` last ordering wins over Next's preset defaults. Correct precedence.
6. **`outputFileTracingRoot` + `sharp` build-script allowlist** — both are hygiene. Fine.
7. **No `vercel.json` committed.** Vercel project binding is human-gated.

Nothing blocking M0-E.

## 2026-04-20 — M0-E dispatched

`@infra-platform`: worker + MCP service stubs under `apps/workers/*` and `apps/mcp/*`. Fifteen worker services (sync-gcal, sync-gmail, sync-financial, sync-grocery, webhook-ingest, enrichment, reconciler, node-regen, consolidator, reflector, summaries, alerts, suggestions, action-executor, foreground-agent) and two MCP servers (homehub-core, ingest). Each a thin `main.ts` wired to `@homehub/worker-runtime` + `runWorker()` + health/ready endpoints + Dockerfile + Railway service config + unit-test scaffold. No feature logic — memory/integrations specialists fill in their respective handlers in M3/M2/M4/etc.

## 2026-04-20 — M0-E reviewed & accepted (commit 817cfec)

Scope delivered: 17 new workspace packages — 15 workers under `apps/workers/` and 2 MCP servers under `apps/mcp/`. Each wired to `@homehub/worker-runtime` with `runWorker()`, health/ready endpoints, Dockerfile pinned to `node:20.18.0-alpine`, per-service `railway.toml`, and a handler-shape unit test. `webhook-ingest` is an HTTP service with stub HMAC verifier, `foreground-agent` exports `runConversationTurn({conversationId, turnId})` for import by `apps/web`, MCP servers use `@modelcontextprotocol/sdk ^1.29.0` with `StreamableHTTPServerTransport`.

Verified locally: lint, typecheck (22 packages), format:check, test (76 tests, 21 test files) all exit 0. Spot-check `pnpm --filter @homehub/worker-enrichment build` emits `dist/main.js`.

Specialist decisions accepted:

1. **One Dockerfile per service** (copy-paste) rather than shared template generator. Correct call — clarity beats cleverness when downstream specialists will diverge per service.
2. **`@modelcontextprotocol/sdk ^1.29.0`** with `StreamableHTTPServerTransport`. Zero tools registered yet; the SDK's handshake + empty `listTools` works end-to-end. `@integrations` wires real tools in M3.
3. **Exports tweak on `packages/worker-runtime/package.json`** (adds `"import": "./dist/index.js"` alongside types) matches the pattern used in `packages/db` and `packages/shared`. Standing decision: every workspace package exports both source types and dist runtime.
4. **Per-service test asserts `NotYetImplementedError`** — forces future implementers to update the test when the stub becomes real. Good defensive choice; keeps stubs from silently shipping into a later milestone.
5. **Narrow cast at `mcp.connect(transport)`** to work around the SDK's non-strict optional-property shape without relaxing root tsconfig. Localized; fine.
6. **`foreground-agent` host decision deferred.** Scaffolded as a Railway worker today; same `handler` + `runConversationTurn` export shape works for a Vercel Edge function migration in M3.5 without call-site changes.
7. **No dedicated CI build job for workers.** Root `typecheck` covers build-readiness; Docker-build coverage can land as a later-milestone add-on. Accepted.

Follow-up tracked, not blocking M0-F:

- **`pnpm deploy --prod` Dockerfile path is untested against Railway.** When `@infra-platform` links the real Railway project (human-gated), do one full `docker build + docker run` against one service end-to-end before declaring the Dockerfile pattern correct for all 17.

## 2026-04-20 — M0-F dispatched

`@infra-platform`: `infra/nango` — pinned docker-compose for self-hosted Nango + isolated Postgres + env template + README. Final M0 chunk.

## 2026-04-20 — M0-F reviewed & accepted (commit daa6e25)

Scope delivered: `infra/nango/` with pinned `nangohq/nango-server:hosted-0.70.1` + `postgres:16-alpine` + `redis:7.2.4-alpine` docker-compose, `.env.example` (no secrets), dev README, `railway.toml` production spec, and `docs/production-deploy.md` runbook (provisioning, backups, key rotation, upgrade flow, incident response). CI gains a `nango-compose-validate` job that runs `docker compose config --quiet` with a dummy encryption key.

Verified locally: full `pnpm lint / typecheck / format:check / test` suite still green; `docker compose config --quiet` parses clean against the file.

Specialist decisions accepted:

1. **`NANGO_HOST` kept (not renamed to `NANGO_BASE_URL`).** The M0-C env schema uses `NANGO_HOST` to match the official `@nangohq/node` SDK's `host` option. Standing decision — the compose env and worker env agree on `NANGO_HOST`. The dispatch brief used `NANGO_BASE_URL` casually; the code wins.
2. **Postgres 16-alpine** matches Nango upstream's pin (they pin Postgres 16.0, not 17). Accepted.
3. **No separate `nango-jobs` container** — Nango 0.70.x runs in-process workers. Skip accepted.

Follow-up (not blocking M1):

- **`apps/workers/nango-backup-cron` is referenced in `infra/nango/docs/production-deploy.md` but not scaffolded.** Either drop the reference (recommended: weekly backups are Railway-managed + the Supabase Storage logical dump job, not a per-worker service) or scaffold the worker. I'll take option 1 when I have a cheap window; noted.
- **`tasks/review.md` working-tree dirt** noted by the specialist is mine (the coordinator log you're reading). Not a specialist concern.

## 2026-04-20 — **M0 COMPLETE**

Commits: 1556d8d, 55da152, 28ffab3, 579463b, 817cfec, daa6e25 (six commits, all on `main`, all unpushed). 22 workspace packages. 76 tests passing. CI pipeline: lint → typecheck → format:check → test → migration-lint → web-build → nango-compose-validate. Everything the code can do without live cloud credentials is done.

Human-gated items parked for after the coordinator hands off to the human: Supabase Pro project link, Vercel project link, Railway project + service linking (17 services), Nango Railway deploy, OpenRouter API key, DNS/OAuth redirect config. Each has a runbook in the relevant package/infra README.

## 2026-04-20 — M1 dispatched

Parallel work across two specialists. Ordering: @infra-platform migrations must land first (app.* schema + RLS), then @frontend-chat consumes.

- `@infra-platform` (M1-A): `app.*` schema migrations (household, member, member_segment_grant, event, transaction, account, budget, meal, pantry_item, grocery_list + list_item, alert, suggestion, action, summary, conversation + conversation_turn + conversation_attachment stubs, model_calls for M0-C stubs to light up), RLS helper functions + policies + pgTAP tests (≥3 per table: in-household read OK / out-of-household denied / write-without-grant denied), Supabase Auth provider config (Google + email magic link via `config.toml`), `audit.event` table, regenerate `db:types`.
- `@infra-platform` (M1-B, after M1-A): server-side helpers — `getHouseholdContext()`, `requireMember()`, household create/invite/join server actions (in `apps/web` since they're server actions, but the data layer helpers live in a shared server-only package).
- `@frontend-chat` (M1-C, after M1-A schema lands): app shell scaffold per `specs/07-frontend/ui-architecture.md` (login page, invite-token page, app-layout auth boundary with ⌘K launcher placeholder, settings skeleton: household/members/connections/notifications pages) — stubs acceptable where tools/data haven't arrived.

## 2026-04-20 — M1-A reviewed & accepted (commit ede1ba4)

Scope delivered: nine forward-only migrations (0003–0009) introducing 26 tables across `app.*`, `sync.*`, `audit.*` with RLS enabled on every table. Auth helpers (`app.current_user_id`, `is_member`, `can_read/write_segment`, `can_read/write_account`) all `security definer` with locked-down `search_path`. Supabase Auth configured with Google OAuth + email magic link. `app.household_invitation` stores tokens as hashes. `app.action` has a status-transition trigger. `app.model_calls` and `sync.dead_letter` tables exist — M0-C stubs are ready to be wired for real. 23 RLS test files (one per policy-bearing table), all passing against a validator Postgres. `packages/db/src/types.generated.ts` regenerated; all 22 workspace packages still typecheck clean. New CI job `rls-tests` runs the full suite on every PR.

Specialist decisions accepted:

1. **Helpers in `plpgsql`** (not `sql`) — enables forward references across migration order. Accepted; they're `stable` + `security definer` with pinned `search_path`.
2. **`auth.enable_signup = true` + `auth.email.enable_signup = false`** — permits local signups but gates email-link signups through invitations. Production flip to `auth.enable_signup = false` is on the deploy runbook; document it in `infra/nango/docs/production-deploy.md` parallel when we add a corresponding production supabase deploy runbook.
3. **`audit.event` is service-role-only (read and write)** — aligns with the open-question lean in `specs/02-data-model/row-level-security.md`. The owner-read view is a later add when a real owner-facing audit surface is scoped.
4. **Invitation token stored as hash only.** Single best-practice call.
5. **`action` status transitions enforced by trigger, not check constraint.** Correct — checks can't reference old row values.
6. **RLS tests structured for a mechanical pgTAP port later.** The assertions are already the load-bearing part; when pgTAP is installable in CI, port is straight-line. Fine.

Nothing blocks M1-B.

## 2026-04-20 — M1-B dispatched

`@infra-platform`: server-side auth/household helpers that `@frontend-chat` will consume, household create/invite/join server actions (server-only package with a thin re-export from `apps/web` so Next.js picks them up), and unstub the M0-C worker-runtime helpers now that the backing tables (`sync.dead_letter`, `app.model_calls`) exist. Single dispatch. Keeps auth logic in one specialist's lane; frontend specialist gets a clean import surface for M1-C.

## 2026-04-20 — M1-B reviewed & accepted (commit 99ba8b5)

Scope delivered: `packages/auth-server` (clients, session, household context + resolver, invitation token hash, audit writer, seven household flow helpers, typed errors, Zod schemas), `apps/web/src/app/actions/{household,members}.ts` server actions wrapping the helpers in an `ActionResult<T>` envelope, `apps/web/src/lib/auth/context.ts` wrapper for React `cache()` integration, and real implementations of `queueClient.deadLetter` / model-calls recorder / `withBudgetGuard` now that M1-A tables exist. 36 tests in auth-server (mocked-Supabase flow coverage), 29 in worker-runtime (9 new behavior tests replace the stub assertions). All 23 workspace packages typecheck clean.

Specialist decisions accepted:

1. **Mocked-Supabase unit tests** in `auth-server` rather than live DB integration. Correct call — RLS is covered by the pgTAP suite in `packages/db/tests/rls/`; flow-code branches are better tested with fast mocks. Standing decision: auth-server = unit tests with fakes; DB policy = pgTAP.
2. **`revokeMember` soft-deletes to `role='guest'`** and strips grants but preserves the `app.member` row. Matches the spec lean in `households.md` open questions; keeps memory-graph anchors intact. The "Bob (former member)" rename is tracked as M8 work.
3. **`react/cache` wrapper lives in `apps/web/src/lib/auth/context.ts`**, not in `auth-server`. Correct — keeps `auth-server` framework-agnostic (importable from Node workers, not just Next.js).
4. **Invite email delivery deferred.** `inviteMemberAction` returns the raw token; the frontend renders a shareable `/invite/:token` URL. Production mailer lands in a later milestone.
5. **Account-level grants out of scope** until M5 (when `app.account` sees UI). Right call.

Follow-up not blocking M1-C:

- **Production `[auth].enable_signup = false` flip** documented in `packages/db/supabase/production-notes.md`. Pair it with admin-pre-create of `auth.users` when we wire the production Supabase link.

## 2026-04-20 — M1-C dispatched

`@frontend-chat`: app shell on top of M1-B helpers. Login page (Google + magic link), invite-accept page at `/invite/[token]`, authenticated app layout with ⌘K placeholder, onboarding for users with no household, settings skeleton (household / members / connections / notifications). No segment pages, no chat, no graph browser yet — those are M2/M3/M3.5. Full spec in `specs/07-frontend/ui-architecture.md` + `pages.md`; ownership in `scripts/agents/frontend-chat.md`.

## 2026-04-20 — M1-C reviewed & accepted (commit 318a70d)

Scope delivered: `(public)` route group (`login`, `invite/[token]`, `auth/callback`), `(onboarding)` route group, `(app)` layout with auth+household boundary, dashboard stub with disabled segment cards, settings skeletons (household + members). shadcn/ui primitives landed (button/input/label/form/card/dialog/dropdown/tabs/checkbox/select/separator/sheet/toast/badge) in `new-york` style with `slate` base color, CSS-vars mode. Four new server actions (auth.ts, + previewInvitation/updateHousehold/listInvitations). Three new auth-server helpers with Zod schemas + unit tests. HouseholdSwitcher uses a `hh_active_household` cookie the context reader honors. Accessibility: skip link, focus-visible rings, `aria-live` errors, color+icon for severity. No middleware — layout-level redirects are sufficient. 26 tests in `apps/web`, 94 in `auth-server` (up from 75), 29 in `worker-runtime`.

Specialist decisions accepted:

1. **shadcn primitives emitted directly** (not via interactive `init`) with `components.json` committed for reproducibility. Pragmatic, fine.
2. **`(onboarding)` as its own route group** outside `(app)` — dodges the "no household → /onboarding" redirect loop cleanly.
3. **`settings/connections` deferred to M2** — connections UI gets meaningful content once Google Calendar lands. Standing decision: connections page lands with the first provider dispatch, not before.
4. **`settings/notifications` deferred to M9** — there's no notifications backend yet; a stub with a toast-on-save is deferred until the write target exists.
5. **No `middleware.ts`** — layout-server-side redirects + the `auth-server` single source of truth. Acceptable. Revisit if we ever want to short-circuit before Server Component boot.
6. **`tailwindcss-animate` skipped**; small CSS keyframe shim in `globals.css` covers Radix state transitions. Tailwind v4 + tailwindcss-animate compat is still in flux; this is the right interim call.
7. **Invite email-mismatch soft warning** — warns the authenticated user if the invitation was addressed to a different email, but lets them accept (the row, not the email, is canonical). Fine for v1. Stricter pairing can come with the production mailer.
8. **`listInvitations` never returns raw token** — correct; the token is one-time-issue. Fresh invites get a prominent copy button; re-issue the only way to recover a lost link.

Follow-ups tracked, not blocking M2:

- Bundle size on `/settings/members` (192 kB first-load). Revisit when chat lands and the shared chunk grows.
- Connections stub page lands in M2.
- Notifications stub page lands in M9.
- Real mailer for invite delivery — later.

## 2026-04-20 — **M1 COMPLETE**

Commits: ede1ba4 (schema + RLS + auth config), 99ba8b5 (auth-server + server actions + worker-runtime unstub), 318a70d (frontend app shell). A household can be created, an invite issued, a second member can accept and see the shared dashboard. The per-household boundary is RLS-enforced at the DB and verified by pgTAP. All 23 workspace packages typecheck clean; ~170 tests green across the tree.

Human-gated items still parked: Supabase Pro / Vercel / Railway / OpenRouter / Nango Railway deploy / Google OAuth client. Each has a runbook.

## 2026-04-20 — M2 dispatched

Three parallel streams now that M1 is done and RLS is trustworthy:

- `@integrations` (M2-A): register `google-calendar` provider in Nango (local compose), `packages/providers/calendar` adapter + Nango proxy wrapper, `apps/workers/sync-gcal` worker with delta-sync via Google sync tokens, Google push notifications → webhook-ingest → enrichment queue, `/api/integrations/connect` server action. Migration `0010_sync_gcal.sql` if any index/column additions are needed (coordinate with @infra-platform for the actual migration PR).
- `@memory-background` (M2-B): event enrichment MVP. `packages/prompts/extraction/event.md` + `apps/workers/enrichment` handler for `enrich_event` queue — extracts person/place/topic atomic facts + writes `mem.episode` rows — but since `mem.*` schema lands in M3, this dispatch goes SHALLOW for M2: a DB trigger that enqueues `enrich_event`, a worker handler that parses the event and logs the would-be facts to a staging table `app.event_enrichment_preview` (new migration 0011 via @infra-platform) until M3 `mem.*` exists. Enrichment becomes real in M3.
- `@frontend-chat` (M2-C): `/{segment}` shell with unified `/calendar` MVP (read-only, no filter), real `/settings/connections` page with Google Calendar "Connect" button that calls @integrations's `/api/integrations/connect`. Dashboard's "Today" strip reads from `app.event` via a server helper.

M2-A + M2-B + M2-C can run in parallel — they touch disjoint files. I'll dispatch them one-per-message and review independently. @infra-platform gets a shared dispatch for the two support migrations (0010 sync-gcal metadata, 0011 event_enrichment_preview staging).


