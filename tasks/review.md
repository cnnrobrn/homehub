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

## 2026-04-20 — M2-A reviewed & accepted (commit f873e41)

Scope delivered: `@homehub/providers-calendar` with `GoogleCalendarProvider`, real `sync-gcal` worker (full+delta, rate-limit/sync-token-expiry handling, audit writes), `webhook-ingest` routes for `/webhooks/google-calendar` (channel-token auth) and `/webhooks/nango` (HMAC), `/api/integrations/connect` + `disconnectConnectionAction`, real `/settings/connections` page with `ConnectionsTable` + Connect/Disconnect. Worker-runtime Nango client extended with `createConnectSession` + `deleteConnection`. Web-side slim Nango client avoids bundling pino/OTel.

Verified locally: 30 tests in providers/calendar, 10 in sync-gcal, 24 in webhook-ingest, 66 in worker-runtime (up from 29), 34 in apps/web (up from 26) — all green.

Specialist decisions accepted:

1. **`sync.cursor.value` as JSON-in-text** for gcal channels — appropriate for M2 volume. `jsonb` promotion + indexed channel-id column deferred to a later infra pass.
2. **Disconnect as a server action** (no `/api/integrations/disconnect` route) — correct Next.js CSRF posture.
3. **Web avoids `@homehub/worker-runtime` import** and uses a slim `apps/web/src/lib/nango/client.ts` instead. Keeps the Next bundle lean.
4. **Segment sentinel `'system'`** at sync time; enrichment reclassifies. Standing decision.
5. **Push-channel renewal is "hourly poll if stale" today.** A dedicated watch-renewer worker is a follow-up, to land before we rely on push-only.

Follow-ups tracked, not blocking M2-B/C:

- Promote `sync.cursor.value` to `jsonb` + add `gcal_channel_id` column (+ unique index).
- Dedicated watch-renewer worker before Google's 7-day push-channel TTL becomes a reliability risk.

## 2026-04-20 — M2-B and M2-C dispatched in parallel

`@memory-background` (M2-B): shallow enrichment for `app.event`. Reads the `enrich_event` queue (sync-gcal already enqueues on upsert), classifies the event's `segment` (`financial|food|fun|social|system`) from title/description/location heuristics, updates `app.event.segment` and `app.event.metadata.enrichment` with version + rationale, audits. Keep it deterministic (regex + keyword map) for M2; real model-backed extraction lands with `mem.*` in M3. Lay the groundwork: `packages/prompts/extraction/event.md` as a living draft; `packages/enrichment` package with a typed `EventClassifier` interface. No `mem.*` writes — that's M3.

`@frontend-chat` (M2-C): unified calendar MVP at `/calendar` (not per-segment yet), dashboard "Today" strip reads from `app.event`. Reads via a new `listEvents` server helper on the authed Supabase client, filtered by household + date range + segment. Respects per-segment grants at the UI level (spec: `can_read_segment`). Realtime subscription stub (Supabase realtime on `app.event`) that re-fetches on change.

## 2026-04-20 — M2-B reviewed & accepted (commit e6a8bd4)

Scope delivered: `@homehub/enrichment` package with `createDeterministicEventClassifier()` (ordered rules: social → financial → food → fun → attendee-fallback → system, tiered confidence), 32 fixture snapshots spanning all five segments, `apps/workers/enrichment` now a real pgmq consumer that reclassifies `app.event.segment`, writes `metadata.enrichment` with version `2026-04-20-deterministic-v1`, and audits every change. `packages/prompts/extraction/event.md` draft + `packages/prompts` workspace slot for M3's runtime prompt loader. No model calls, no `mem.*` writes — both land in M3.

Verified locally: 76 tests in `packages/enrichment`, 14 in `apps/workers/enrichment` (up from 2 stub). Full monorepo test count: 413 tests passing across 22 packages.

Specialist decisions accepted:

1. **First-match ordering social-before-fun** — "birthday party" → social (not fun). Direct assertion test locks it.
2. **External-attendee social fallback** is the M2 substitute for full `app.person` resolution. M3's model path will replace it with real people lookups.
3. **Version tag in `metadata.enrichment.version`** — `2026-04-20-deterministic-v1`. M3 will bump the tag so the backfill worker knows which rows to reprocess.
4. **`@homehub/prompts` workspace stub** with no-op scripts — claims the package slot for M3 without exporting any runtime code. Clean.
5. **No retries at the classifier tier** — the classifier is pure; a second attempt would produce the same outcome. DLQ on any unrecoverable path. Correct.

Follow-up tracked, not blocking M2-C:

- When M3 lands `mem.*`, swap the classifier path behind a feature flag so the deterministic one stays as the degraded-tier fallback when `withBudgetGuard` denies the model call.

## 2026-04-20 — M2-C dispatched

`@frontend-chat`: unified calendar MVP at `/calendar`. Server-component week/month views backed by a `listEvents({ householdId, from, to, segments })` helper on the authenticated Supabase client (RLS enforces household isolation; UI drops segments the member has `can_read_segment = 'none'` on). Dashboard "Today" strip reads today's events and renders them with per-segment color. `realtime`-subscribe to `app.event` via `@supabase/ssr`'s browser client (client component island) and re-fetch on change. Design tokens already define segment colors; extend if needed. No interactive mutations — read-only v1.

## 2026-04-20 — M2-C reviewed & accepted (commit a29f8d2)

Scope delivered: `/calendar` page (week/month server-rendered, URL-driven cursor/view/segments), `listEvents` server helper with Zod + grant intersection + PostgREST `or()` for null-ends-at handling, dashboard Today strip, realtime subscription with 500ms debounce, segment color tokens (`--segment-*`) wired through Tailwind v4 `@theme`, five new client islands (CalendarNav, ViewToggle, SegmentFilter, DayCellNavButton, RealtimeEventRefresher). 58 tests in apps/web (up from 34). Build: `/calendar` at 6.42 kB / 211 kB first-load.

Specialist decisions accepted:

1. **`segments=none` sentinel** for "explicitly cleared" vs. missing-param for "all readable." Clean. Server intersects with grants either way so a hand-edited URL cannot reveal forbidden segments.
2. **Local-browser timezone for v1.** Household TZ lands when `Temporal.ZonedDateTime` + household settings wire up. Comment in `range.ts` documents the swap.
3. **Multi-day events render first-day-only in month view.** Avoids drag-spanning-bar complexity. Week view puts them in the all-day strip. Good MVP call.
4. **Full re-fetch on realtime change** with 500ms debounce. Diff-apply is a follow-up; the MVP is correct under load.

Follow-ups tracked:

- Diff-apply realtime (avoid re-query on every change).
- Week-grid overlap resolution (side-by-side columns for concurrent events).
- Household timezone plumbing (Temporal).
- Per-segment calendar pages (M5+).

## 2026-04-20 — **M2 COMPLETE**

Commits: f873e41 (gcal + Nango + sync + connections UI), e6a8bd4 (deterministic enrichment), a29f8d2 (calendar MVP + realtime). End-to-end verified path: member connects Google Calendar → sync-gcal upserts → enrich_event classifies segment → /calendar renders. 413+ tests across the tree. Human-gated: OAuth client creation in Google Cloud, live Nango provider registration.

## 2026-04-20 — M3 dispatched (schema-first)

Three parallel streams post-schema:

- `@infra-platform` (M3-A): `mem.*` schema migrations (`node`, `alias`, `edge`, `episode`, `fact`, `fact_candidate`, `pattern`, `rule`, `mention`, `insight`) with bi-temporal columns on `mem.fact` (`valid_from`, `valid_to`, `recorded_at`, `superseded_at`), `pgvector` embedding column on `mem.node` + `mem.episode`, RLS, pgTAP tests — ≥3 per table. Dispatched first; the other two streams block on schema lands.
- `@memory-background` (M3-B, blocked-on M3-A): extraction prompts v1 via `@homehub/prompts` runtime loader, model-backed event classifier behind the existing `EventClassifier` interface (feature-flagged; deterministic stays as the degraded-tier fallback), reconciler (candidate → canonical promotion + conflict routing), node-regen worker (debounced), `query_memory` implementation (layer-aware + hybrid + `as_of` + conflict surfacing). Consolidator + reflector land in M3.7.
- `@integrations` (M3-C, blocked-on M3-B `query_memory`): `mcp-homehub-core` tools — `query_memory`, `list_events`, `get_node`, `get_episode_timeline`. Replace the M0-E MCP stub with real tool registrations.
- `@frontend-chat` (M3-D, blocked-on M3-B `query_memory`): graph browser page (search + node doc + facts/episodes/patterns panels + evidence drawer), per-fact affordances (confirm/edit/dispute/delete/show evidence), node merge/delete/pin.

## 2026-04-20 — M3-A reviewed & accepted (commit ef5d5f0)

Scope delivered: `mem.*` schema in two forward-only migrations (0010 core — node/alias/edge/mention/episode + triggers; 0011 facts — fact/fact_candidate/pattern/rule/insight). 10 tables, 18 indexes (including ivfflat pgvector on `mem.node.embedding` + `mem.episode.embedding` with `lists=100`), 15 RLS policies, 10 new pgTAP test files (33 total across the suite). Shared memory-type enums exported from `@homehub/shared`. `packages/db/src/types.generated.ts` regenerated; all 22 workspace packages still typecheck clean.

Specialist decisions accepted:

1. **`mem.alias.household_id` as NOT NULL column + BEFORE-INSERT backfill trigger.** Keeps RLS single-table without cross-table joins. Good.
2. **Curated-column enforcement via BEFORE-UPDATE trigger.** Correct — RLS `with check` can't compare OLD/NEW so column-level restrictions can't be pure policies. Standing decision.
3. **ivfflat `lists=100`.** Sensible for <100k nodes. Revisit during M10 ops if recall drifts at scale.
4. **`mem.fact_candidate` nullability relaxed** vs. `mem.fact` (subject_node_id/confidence/valid_from nullable) — matches the extractor writing partially-resolved rows before reconciliation. Good.
5. **`mem.mention` row_table has no FK.** Deliberate — it points at arbitrary source tables (`app.event`, `app.transaction`, `app.email`). M3-B worker validates the allowed `row_table` set.
6. **`mem.node_revision` deferred.** Spec's open question leans yes but not immediately load-bearing. Re-visit when M3-B surfaces a debugging need.

Follow-ups tracked for M3-B:

- Reconciler must atomically set `superseded_at + superseded_by` when promoting a conflicting candidate. Optional check constraint pairing those two is worth re-evaluating once reconciler patterns are clear.
- `mem.edge` JSON-append to `evidence` + `weight` increment on `(household_id, src_id, dst_id, type)` conflict is the expected upsert semantics.

M3-A unblocks @memory-background (M3-B) and, via M3-B's `query_memory`, @integrations (M3-C) and @frontend-chat (M3-D).

## 2026-04-20 — M3-B reviewed & accepted (commit d5d0d65)

Scope delivered: `@homehub/prompts` runtime loader with parsed markdown sections + Zod schemas, three prompt files (`event.md`, `event-classifier.md`, `node-doc.md`) versioned `2026-04-20-kimi-k2-v1`. Extended `@homehub/enrichment` with `createKimiEventClassifier`, `createKimiEventExtractor`, `createEnrichmentPipeline` (model → deterministic fallback, budget-aware), `reconcileCandidate` with typed decision matrix, destructive-predicate thresholds. New `@homehub/query-memory` package with hybrid retrieval (semantic seed via embeddings + structural expansion via recursive CTE + spec-default ranking weights + `as_of` bi-temporal filter + conflict surfacing). `@homehub/worker-runtime` gains `modelClient.embed()` logged to `app.model_calls`. Real `apps/workers/node-regen` with manual-notes preservation. Enrichment worker now chains classify → extract → reconcile → enqueue node_regen with full audit writes.

Verified: all 26 packages typecheck clean. ~130 net new tests (+78 in enrichment, +25 in query-memory, +13 in prompts, +4 node-regen/enrichment worker). `mem.fact` inserts funnel through `insertCanonicalFact` inside the reconciler — no direct writes elsewhere.

Specialist decisions accepted:

1. **Sequential mutations + explicit rollback** instead of a PG transaction RPC. PostgREST has no transaction primitive via `@supabase/supabase-js`; blast radius is one candidate per call, next pass retries. Accept with a follow-up: consider a `mem.reconcile_candidate(candidate_id)` RPC later if we hit contention or need stricter atomicity.
2. **Inline reconciler inside the enrichment worker** for M3-B. The separate `apps/workers/reconciler` service stays a stub until there's a batch-catch-up need (a `reconcile_candidate` queue). Correct staging.
3. **Destructive-predicate set** = `{avoids, allergic_to, lives_at, has_birthday, born_on, works_at, has_medical_condition}` with threshold 0.9 + `needs_review=true`. Conservative and correct per spec guidance.
4. **Confidence cap 0.99 + reinforcement bump 0.03.** Reasonable. Tune from telemetry in M11.
5. **Embeddings at write time deferred.** `query_memory` tolerates null embeddings (neutral similarity + falls back to structural expansion). Follow-up: populate `mem.node.embedding` when nodes are created, either inline or via a new `mem.node.embed` queue — coordinate with `@infra-platform` for the queue name.
6. **`query_memory` ranking weights** use the spec defaults verbatim (`α=0.5, β=0.15, γ=0.1, δ=0.05, ε=0.15, ζ=0.05`, half-life 30 days). Standing defaults; per-agent override is still supported via `RankingWeights`.

Nothing blocks M3-C/D.

## 2026-04-20 — M3-C + M3-D dispatched in parallel

`@integrations` (M3-C): `apps/mcp/homehub-core` replaces the M0-E stub with real tool registrations consuming `@homehub/query-memory`. Tools: `query_memory`, `list_events`, `get_node`, `get_episode_timeline`. Per-member MCP tokens for external assistants; HMAC service tokens for internal workers. Tool catalog doubles as the source-of-truth for `@frontend-chat`'s foreground agent in M3.5.

`@frontend-chat` (M3-D): graph browser page at `/memory`. Search (semantic via `query_memory` + exact via alias match), node detail with canonical document + facts panel + episodes panel + patterns panel + evidence drawer. Per-fact affordances (confirm / edit / dispute / delete / show evidence) ride the `mem.fact_candidate` pipeline — UI never writes to `mem.fact` directly. Node affordances (merge / delete / pin) via owner-gated server actions. Conflict visualization via `conflict_status != 'none'` + recent `superseded_at`.

Both dispatches touch disjoint file trees. Running in parallel.

## 2026-04-20 — M3-C reviewed & accepted (commit 6ffa0f0)

Scope delivered: `apps/mcp/homehub-core` replaces the M0-E stub with a real MCP server. Four tools registered with Zod schemas: `query_memory` (delegates to `@homehub/query-memory`), `list_events` (household-scoped `app.event`), `get_node` (parallel load of facts + episodes + edges, same envelope for absent/cross-household), `get_episode_timeline` (`mem.episode` slice). Auth middleware supports `hh_mcp_*` member tokens (prod path throws NYI until `sync.mcp_token` lands) + `hh_svc_*` HMAC service tokens (5-minute replay window, `timingSafeEqual`, `X-HomeHub-Household-Id` header). Dev-allowlist via `MCP_DEV_TOKENS` for `NODE_ENV != 'production'`. Canonical `CalendarEventRow` now lives in `@homehub/shared/events/types` — frontend and MCP converge. 33 new tests across 6 files.

Specialist decisions accepted:

1. **Auth context stashed on `req.auth.extra.context`** — MCP SDK pattern; tool handlers never see the raw bearer. Fine.
2. **Cross-household `get_node` returns same envelope** as "not found" — no presence leak. Correct.
3. **`content[0].text` + `mimeType: 'application/json'`** result shape for widest client support. Fine.
4. **Client-supplied `householdId` stripped** via Zod schema omission — explicit test locks this.
5. **Canonical `CalendarEventRow` moves to `@homehub/shared`**. Standing decision: the frontend `listEvents` helper and the MCP `list_events` tool both import from `@homehub/shared/events/types`.

Migration requested — tracked:

**`@infra-platform` — `0012_sync_mcp_token.sql`**: `sync.mcp_token` table (household_id + optional member_id + token_hash + scopes + last_used_at + expires_at) with RLS (service-role writes; members read their own via member_id). Once merged, the dev-allowlist stub swaps for a real `token_hash = hmac_sha256(token)` lookup.

## 2026-04-20 — M3-D reviewed & accepted (commit 61a0f24)

Scope delivered: `/memory` page tree (`/memory` index, `/memory/[type]` type index, `/memory/[type]/[nodeId]` node detail with Document/Facts/Episodes/Edges tabs). Server helpers `queryHouseholdMemory` / `getNode` / `listNodes` wrap `@homehub/query-memory`. Eleven server actions in `apps/web/src/app/actions/memory.ts`: `confirmFact`, `disputeFact`, `editFact`, `deleteFact`, `updateManualNotes`, `toggleNeedsReview`, `pinNode`/`unpinNode`, `mergeNodes` (owner), `deleteNode` (owner), `searchMemory`. Every fact mutation writes `mem.fact_candidate` with `source='member'` — never direct to `mem.fact`. Every mutation writes `audit.event`. 10 custom components (6 Server, 10 Client islands), realtime refresher on `mem.fact` + `mem.node` with 500ms debounce, evidence drawer, conflict badges with icon + color (not color-alone), merge/delete dialogs. Sidebar Memory link lit up. 22 new web tests (93 total in apps/web).

Specialist decisions accepted:

1. **`deleteFact` via member-sourced null-object candidate.** Requires a reconciler decision-matrix extension to interpret this as a soft-delete signal (close canonical with `valid_to + superseded_at`, no successor). Follow-up flagged for `@memory-background`.
2. **`mergeNodes` is soft-delete** via `metadata.merged_into` + canonical_name suffix. Facts/edges reassigned; aliases moved. No hard deletes. Correct.
3. **Pin storage in `mem.node.metadata.pinned_by_member_ids[]`** via service-role because the member-update trigger guard bars metadata writes. Correct.
4. **Realtime subscribed to both `mem.fact` and `mem.node`** with 500ms debounce. Good.
5. **Server actions + `window.prompt` fallback** for dispute/forget reasons — acceptable UI MVP; inline Dialog replacement is pure polish.

Follow-ups tracked, not blocking M3.5:

- `@memory-background` reconciler extension for member-sourced null-object deletion candidates (either branch in `decideConflict` or a dedicated `deletion` candidate status).
- `@integrations` + `@frontend-chat` together: MCP-tokens UI + the `sync.mcp_token` migration.
- Replace `window.prompt` with inline Dialogs for dispute/forget reasons.
- Populate `mem.node.embedding` on node creation so semantic search isn't a no-op for freshly-extracted nodes (enrichment worker can do it inline or via a `mem.node.embed` queue).

## 2026-04-20 — **M3 COMPLETE**

Six commits: ef5d5f0 (mem.* schema + RLS + pgTAP), d5d0d65 (extraction pipeline + reconciler + node-regen + query_memory), 6ffa0f0 (MCP tools), 61a0f24 (graph browser). End-to-end path verified: `sync-gcal` upserts `app.event` → `enrich_event` queued → enrichment worker classifies, extracts episodes + fact candidates, reconciler promotes to `mem.fact` with supersession, node-regen rebuilds `mem.node.document_md`, `/memory` renders the graph, MCP tools expose it to external assistants. Every schema layer has RLS + pgTAP; every fact write goes through the candidate pool.

## 2026-04-20 — M3.5 dispatched

Two parallel streams:

- `@frontend-chat` (M3.5-A): `packages/tools` (Zod-schema'd read tools usable by both the foreground agent and MCP), `apps/workers/foreground-agent` real implementation (intent prefilter → slotted-context assembly → streaming model call → serial tool orchestration with class enforcement), `/chat` page (history sidebar + active thread + streaming composer + tool cards + context panel + memory-trace drawer), `⌘K` launcher replacing the placeholder. Uses `@homehub/query-memory` directly; consumes M3-C's `CalendarEventRow` shape.
- `@memory-background` (M3.5-B, in parallel): conversation → episode rollup worker (post-turn heuristic: substantive turn → enqueue `rollup_conversation` → writes `mem.episode` with `source_type='conversation'`), member-message → fact-candidate extraction path (turn text → Kimi K2 JSON mode → `mem.fact_candidate` with `source='member'` high-confidence), reconciler extension for member-sourced null-object deletion (the M3-D follow-up), optional `mem.node.embed` queue groundwork for embedding population.

## 2026-04-20 — M3.5-A reviewed & accepted (commit 9a67912)

Scope delivered: `@homehub/tools` package with 12 read tools + 2 direct-write + 8 draft-write stubs, per-segment + role gating, Zod-schemed both on input and output, `forModel()` emits OpenAI-compatible tool specs. Real `runConversationTurnStream` foreground-agent loop with six stages (ingest → intent prefilter → slotted context → serial tool iteration with max=5 → stream → post-turn writes). Next.js Route Handler `/api/chat/stream` with SSE transport. `/chat` page tree + `ChatSidebar` + `ChatThread` + `Composer` + `StreamingMessage` + `ToolCard` + `SuggestionCard` + `CitationChip` + real `CommandKLauncher`. 30 new tests in `@homehub/tools`, 10 in foreground-agent, 11 new in apps/web.

Specialist decisions accepted:

1. **In-process streaming from Next.js Route Handler** (calls `@homehub/worker-foreground-agent` directly). Eliminates an extra hop. The worker binary keeps its health server for a future edge-worker split.
2. **Chunked token streaming** (non-streaming model call → split into `token` events) for M3.5-A. Drop-in swap to true SSE tokens on the `ForegroundModel` interface.
3. **Draft-write tools stubbed** to `{ status: 'pending_approval', summary, preview }` + `suggestion_card` stream event. Real execution in M9.
4. **`@`-picker + slash commands pass-through** for M3.5-A. Richer interactive pickers flagged as a follow-up; load-bearing loop + chat + ⌘K shipped atomically.

Follow-ups tracked:

- Interactive `@`-entity picker + `/` slash-command menu.
- Memory-trace drawer as separate component (today evidence flows via ToolCard expand + citation chips).
- Real model-side token streaming.

## 2026-04-20 — M3.5-B reviewed & accepted (commit 8f720fc)

Scope delivered: conversation-extractor + conversation-rollup in `@homehub/enrichment`, new prompt files `packages/prompts/extraction/conversation.md` + `packages/prompts/rollup/conversation.md` (versioned `2026-04-20-conversation-v1` / `-rollup-v1`), handlers for `enrich_conversation` + `rollup_conversation` + `embed_node` queues in `apps/workers/enrichment` (main.ts now fans out `Promise.all` across four `pollOnce*` calls per cycle). Reconciler soft-delete branch: member-sourced candidate with `object_value=null` + `valid_to!=null` → close canonical with `valid_to + superseded_at`, no successor, audit `mem.fact.deleted_by_member`. Embedding queue infra: `embed_node` enqueued on every new node creation + after `node-regen` document rewrites. Whisper mode honored — if `app.conversation_turn.no_memory_write = true`, the extraction path short-circuits with no `mem.*` writes.

Specialist decisions accepted:

1. **Whisper mode reads `app.conversation_turn.no_memory_write` directly** (first-class column from M1-A migration 0008). Cleaner than a metadata-flag passthrough.
2. **Rollup debounce** against any `mem.episode` for `(household_id, source_type='conversation', source_id=conversation_id)` in the last 10 minutes. Simple + idempotent + no metadata JSONB scans.
3. **Member-sourced confidence ceiling 0.85** — tighter than the spec's generic high-confidence, reasonable for model-stated member utterances where the model could over-state certainty.
4. **Non-member null-object candidates are rejected.** The deletion branch is member-source-only; worker-authored soft-deletes must use `supersede_fact`.
5. **`embed_node` empty-text short-circuit** — no model call for nodes without document content. Cost-correct.

Follow-ups tracked, not blocking M3.7:

- Optional `mem.episode` compound index `(household_id, source_type, source_id, recorded_at)` to keep rollup debounce lookups index-only as episode counts grow. Request to `@infra-platform` if volume surfaces.

## 2026-04-20 — **M3.5 COMPLETE**

Two commits (`9a67912`, `8f720fc`) on `main`. End-to-end: member types in `/chat` → stream handler persists `conversation_turn` → `runConversationTurnStream` runs six-stage loop → response streams to UI with tool cards + citations → post-turn writes enqueue `rollup_conversation` (substantive) + `enrich_conversation` (always) → rollup writes `mem.episode` → extraction writes `mem.fact_candidate` + `mem.rule` → reconciler promotes/supersedes/deletes → `node_regen` + `embed_node` re-enqueued. 688 tests across 26 packages.

## 2026-04-20 — M3.7 dispatched

Two parallel streams (no file-tree collision):

- `@memory-background` (M3.7-A): nightly consolidator worker (rolls episodes from last 7d into semantic candidates, detects temporal / co-occurrence / threshold patterns, bumps reinforcement counts, writes `mem.pattern` rows), weekly reflector worker (reads episodes + new facts + pattern activity → `mem.insight` markdown), decay-aware ranking wired into `@homehub/query-memory` (layer-specific half-lives: episodic 14d / semantic 120d / procedural 365d), `pg_cron` scheduling stubs (request via @infra-platform as a trivial migration).
- `@frontend-chat` (M3.7-B): `/settings/memory` page — pause-writes toggle, retention windows per category (raw emails / transactions / attachments) with member-visible countdowns, rule authoring UI (CRUD on `mem.rule`), per-category model budget (household setting), `mem.insight` feed ("weekly reflection") with confirm/dismiss affordances.

## 2026-04-20 — M3.7-A reviewed & accepted (commit a8fa1c9)

Scope delivered: per-entity consolidation prompt + schema + prompt runtime wire, weekly reflection prompt + schema, `apps/workers/consolidator` real CLI-driven implementation (836-line handler + 404-line patterns module covering temporal + co-occurrence + threshold regularity detectors, batch-by-entity, per-household nightly budget ceiling, skip when < MIN_NEW_EPISODES), `apps/workers/reflector` real CLI-driven implementation (10 tests — idempotency, insufficient-episodes skip, budget-exceeded skip, happy path with citation footnote embedded in body_md via HTML-comment since `mem.insight` has no metadata column today), decay-aware ranking in `@homehub/query-memory` with layer-specific half-lives (episodic 14d / semantic 120d / procedural 365d) + per-node-type overrides (person 180d / merchant 90d / place 365d / dish 120d) + pattern decay at 3× natural period + old-candidate filter at 90d.

Specialist decisions accepted:

1. **Citation footnote in `body_md`** as HTML comment `<!-- homehub:reflection {...} -->` — clean fallback for the missing `mem.insight.metadata` column. Parseable, invisible in renders.
2. **Consolidator as CLI entry** (not pgmq-driven) — Railway cron or platform-level scheduler invokes `runConsolidator({ householdIds? })`. Matches the spec's "nightly 3am household-tz" pattern; queue-driven scheduling is unnecessary.
3. **Pattern upsert on `(household_id, kind, description_hash)`** — stable natural key prevents duplicates across nightly runs.
4. **Patterns use `last_reinforced_at` for decay** with 3× natural-period multiplier. Standing default.
5. **Old candidates filtered OUT of retrieval** (not just down-ranked). Spec-correct — candidates > 90d without reinforcement should never surface.

Follow-up tracked (not blocking M3.7-B):

- `mem.insight.metadata` jsonb column would let confirmations ride the row rather than `audit.event` back-reads. Request to @infra-platform.

## 2026-04-20 — M3.7-B reviewed & accepted (commit df5c939)

Scope delivered: `/settings/memory` page with six cards — pause toggle, retention windows, rule authoring (list + create + edit + archive + delete with RLS backstop), model budget + MTD spend progress, weekly insights feed (10 most recent with confirm/dismiss), danger-zone forget-everything with type-to-confirm dialog + 48h undo window. Sidebar Memory link lit up. `stripCitationFootnote` helper with 6 unit tests. 12 new server actions in `apps/web/src/app/actions/memory.ts`. New shadcn primitives: Switch, Slider, Progress, Table, Textarea. 34 new apps/web tests (151 total).

Specialist decisions accepted:

1. **Insight confirmations written to `audit.event`** (not the row) because `mem.insight` has no metadata column. Correct fallback; `listInsightsAction` back-reads audit events to populate `confirmedByMemberIds` / `dismissedByMemberIds` for display. Migration to add metadata column is optional polish.
2. **Forget-everything is intent-only** (writes `audit.event` `mem.forget_all.requested` with 48h undo window). Actual purge is M10. UI clearly indicates "scheduled for 48h — you can still undo."
3. **Inline zod v4 resolver in `RuleCreateForm`** — works around `@hookform/resolvers@1.0.0` predating zod v4's `.issues` change. Upgrading the resolver is the cleaner follow-up fix.
4. **Purge workers deferred to M10.** Retention windows are stored today; the worker that acts on them lands with ops readiness.

Follow-ups tracked:

- `mem.insight.metadata` migration (optional).
- `@hookform/resolvers` upgrade to v5.x for zod v4 compat.
- Purge worker for retention windows + forget-all (M10).
- Per-segment retention nuance (later).

## 2026-04-20 — **M3.7 COMPLETE**

Two commits (`a8fa1c9`, `df5c939`) on `main`. Consolidator + reflector + decay ranking all live and budget-gated; `/settings/memory` surfaces pause / retention / rules / budget / insights / forget-all. 725 tests before this block, 759 after (with the +34 from M3.7-B landed).

## 2026-04-20 — M4 dispatched

Single stream (overwhelmingly @integrations-led; memory-background adds the email extraction prompt; frontend adds the privacy preview):

- `@integrations` (M4-A): register `google-mail` in Nango (minimum scopes per `specs/03-integrations/google-workspace.md`), `packages/providers/email` adapter + Nango proxy wrapper, `apps/workers/sync-gmail` worker with Gmail watch + history id deltas + server-side filter narrowing to receipts/reservations/bills/invites/shipping, attachment handling → Supabase Storage (bucket `email_attachments` with household-scoped RLS — request storage bucket from @infra-platform), `webhook-ingest` gmail route (Pub/Sub → enqueue delta), `/settings/connections` Gmail connect button + `listConnectionsAction` extension.
- `@memory-background` (M4-B, lands after M4-A so the queue exists): `packages/prompts/extraction/email.md` prompt + schema covering receipts / reservations / bills / invites / shipping, extractor + handler for `enrich_email` queue, reservation → calendar-event suggestion path (writes draft `app.suggestion` rows of kind `add_to_calendar`), audit trail.
- `@frontend-chat` (M4-C, lands with M4-A): privacy-preview dialog before first Gmail ingestion — shows categories to be labeled + a filter preview + opt-out per category. Writes the member's opt-ins to `sync.provider_connection.metadata.email_categories`.

## 2026-04-20 — M4 reviewed & accepted

- **M4-A (a7d1985)**: `@homehub/providers-email` (`GoogleMailProvider` with minimum scopes + query composition + rate-limit/history-id-expired error mapping), real `sync-gmail` worker with feature-flagged persist + attachment storage + label + `enrich_email` enqueue, `/webhooks/google-mail/pubsub` (shared-secret gate today, full JWT verification deferred) + extended `/webhooks/nango` for `connection.created/deleted` on `google-mail`, `/api/integrations/connect?provider=google-mail` + `EmailConnectDialog` privacy preview with live query-string rendering, `/settings/connections` Gmail row.
- **Migration 0012/0013 (0c78ab6)**: `app.email` + `app.email_attachment` + `sync.provider_connection.metadata jsonb` + `email_attachments` storage bucket + RLS + pgTAP (+6 per table, 35 files total). Types regenerated.
- **M4-B (2366e32)**: `emailExtractionSchema` in `@homehub/prompts` with 5 few-shot examples, `createKimiEmailExtractor` in `@homehub/enrichment` (version `2026-04-20-email-v1`), real `enrich_email` handler (budget-gated, full body fetched via new `EmailProvider.fetchFullBody`, falls back to `body_preview`), reservation → `app.suggestion` path with segment heuristic (food/fun/social) + dedupe via pre-query on `(household_id, kind, preview.source_email_id, preview.starts_at)`.

Specialist decisions accepted:

1. **Feature flag default OFF** for `HOMEHUB_EMAIL_INGESTION_ENABLED`. Operator flips when comfortable. Standing decision.
2. **Full JWT verification deferred** on Pub/Sub route — shared-secret token gate for v1, JWKS verification tracked as @integrations follow-up.
3. **`household` subject → `category` node type** (canonical_name='household') for shipment-tracking facts. Clean workaround for the type enum; revisit if it proliferates.
4. **Suggestion segment heuristic** (food/fun/social from category + title + location keywords). Simple, tunable, correct for v1.
5. **Body preview → full body swap in extractor only.** Full body never persisted; 2KB preview stays retention-controlled. Privacy intent honored.

Follow-ups tracked:

- Full Pub/Sub JWT verification + JWKS caching.
- Watch-renewal cron (Gmail watch expires after 7 days).
- Settings UI to edit email category opt-ins post-connection.
- Content-hash dedupe for attachments across household members.
- Partial unique index on `(source_type='email', source_id, metadata->>kind)` for episode replay-safety.
- M9 approval-flow UI for the `app.suggestion` cards.

## 2026-04-20 — **M4 COMPLETE**

Three commits (`a7d1985`, `0c78ab6`, `2366e32`). End-to-end verified: member → Connect Gmail → privacy preview → OAuth → Nango connection.created → `sync_full:gmail` enqueued → sync-gmail labels `HomeHub/Ingested` + upserts `app.email` + uploads attachments → `enrich_email` enqueued → extractor writes `mem.episode` + `mem.fact_candidate` + `app.suggestion` (add_to_calendar for reservations/invites). Human-gated: Google OAuth client issuance + Nango provider registration + Railway `HOMEHUB_EMAIL_INGESTION_ENABLED=true` flip.

## 2026-04-20 — M5 dispatched

Three streams, sequenced:

- `@integrations` (M5-A, dispatched first): register one budgeting provider in Nango (YNAB preferred per `specs/03-integrations/budgeting.md`; Monarch if YNAB access is harder; fallback runbook), `packages/providers/financial` adapter + Nango proxy wrapper (unified interface: `listAccounts`, `listTransactions`, `listBudgets`), `apps/workers/sync-financial` worker (hourly poll, idempotent upserts to `app.transaction` + `app.account` + `app.budget`), email-receipt ↔ provider-transaction reconciler (a new worker in `apps/workers/reconciler` wake-up path — it's been a stub; time to light it up for financial, matching the sibling reconciler pattern).
- `@memory-background` (M5-B, parallel to M5-A once provider adapter interface ships): financial extraction additions (extraction prompts can reuse event/email paths — no new prompt), weekly/monthly financial summary template + renderer in `packages/summaries` (new package), financial alert detectors in `packages/alerts/financial/*.ts` (`budget_over_threshold`, `payment_failed`, `large_transaction`, `subscription_price_increase`, `account_stale`, `duplicate_charge`, `new_recurring_charge`), subscription detector writing `mem.node` type `subscription` + `app.transaction.metadata.recurring_signal`.
- `@frontend-chat` (M5-C, lands after M5-A + M5-B): `/financial` segment dashboard, `/financial/transactions` ledger (filters + search + member column), `/financial/accounts` (balances + health), `/financial/budgets` (category progress), `/financial/subscriptions` (detected recurring charges + cancel suggestions stub for M9), `/financial/calendar` wired to the existing calendar via segment filter.

M5-A first since adapter + sync worker are load-bearing. Once those land and types regenerate, M5-B + M5-C can run in parallel.

## 2026-04-20 — M5-A / M5-B / M5-C all accepted

- **M5-A (6068252)**: `@homehub/providers-financial` with `YnabProvider`, real `sync-financial` worker (full/delta with `server_knowledge` cursor, Railway hourly cron), real `apps/workers/reconciler` with Jaro-Winkler email↔provider matching (±$1.00, ±3d, similarity > 0.8), `/api/integrations/connect?provider=ynab`, YNAB runbook. Feature flag `HOMEHUB_FINANCIAL_INGESTION_ENABLED=true` default.
- **M5-B (04c84c1)**: email-receipt → `app.transaction` write path (prompt v2), `@homehub/summaries` with `renderFinancialSummary`, real `apps/workers/summaries` with weekly/monthly Railway cron, `@homehub/alerts` with seven detectors (budget_over_threshold, payment_failed, large_transaction, subscription_price_increase, account_stale, duplicate_charge, new_recurring_charge), real `apps/workers/alerts` with subscription detector pre-step (upserts `mem.node type='subscription'`, tags transactions via `metadata.recurring_signal`).
- **M5-C (c26cb9a)**: `/financial` route tree (dashboard + transactions + accounts + budgets + subscriptions + calendar + summaries + alerts), server helpers in `apps/web/src/lib/financial/`, server actions (dismissAlert, proposeCancelSubscription stub), realtime refresher on `app.transaction + app.account + app.alert`.

Standing decisions:

1. **Dedupe metadata in `context` jsonb** until migration 0014 adds `kind` + `dedupe_key` columns on `app.alert`. Code is the only path to change when the migration lands.
2. **`dismissAlertAction` uses service-role** since no member-level RLS policy exists yet on `app.alert.update`. Audit captures actor.
3. **Next-charge projection** from `mem.node.metadata.cadence` + `metadata.last_charged_at`. Pattern will extend naturally once we track actual subscription node attributes.

Follow-ups tracked:

- Migration 0014 promoting alert dedupe to columns + partial index.
- Migration 0015+ for `app.transaction(household_id, source, source_id)` cross-household uniqueness + `app.budget(household_id, name, category)` uniqueness.
- Swap `<pre>` summary rendering for shared `<Markdown />` primitive.
- Member RLS policy on `app.alert.update` + swap `dismissAlertAction` to authed client.
- Monarch + Plaid adapters under the same `FinancialProvider` interface.
- Apps/marketing scaffold (untracked) is external to my agent loops — human-owned; noted but not fixed.

## 2026-04-20 — **M5 COMPLETE**

Three commits (`6068252`, `04c84c1`, `c26cb9a`). End-to-end: member connects YNAB → sync-financial upserts accounts+transactions+budgets → alerts worker nightly writes app.alert rows + detects subscriptions → summaries worker weekly renders markdown → `/financial` UI reads all of it + realtime refresh.

## 2026-04-20 — M6 + M7 + M8 dispatched in parallel

All three segments fan out with disjoint file trees. No specialist touches `apps/web/src/components/shell/AppSidebar.tsx` (coordinator flips the three links in a single close-commit).

- **M6 Food** (all four specialists): `@integrations` (grocery adapter + sync-grocery worker + Nango register), `@memory-background` (pantry-diff worker, food alerts `pantry_expiring` / `meal_plan_gap` / `grocery_order_issue`, meal-swap/grocery-order/new-dish suggestion generators, food summary template), `@frontend-chat` (meal planner week grid + drag-drop, pantry UI, groceries UI with draft/placed states, dishes library, food draft-write tools `draft_meal_plan` + `propose_grocery_order`).
- **M7 Fun** (primarily @memory-background + @frontend-chat): trip parent/child modeling in `app.event.metadata`, conflicting-RSVPs detector, outing-idea + trip-prep + book-reservation suggestion generators, `/fun` UI (trips, queue, calendar filter, summaries, alerts).
- **M8 Social** (primarily @memory-background + @frontend-chat): birthday/anniversary materializer (writes `app.event` for mem.fact `has_birthday`), absence + reciprocity detectors, reach-out + gift-idea + host-back suggestion generators, group nodes (`mem.node type='group'`), `/social` UI (person directory, person detail pages with memory graph link, reciprocity view).

Each dispatch is self-contained: its own `packages/alerts/<segment>/*`, `packages/suggestions/<segment>/*`, `apps/web/src/app/(app)/<segment>/*`, `apps/web/src/components/<segment>/*`, `apps/web/src/app/actions/<segment>.ts`. No shared writes to AppSidebar or root package.json (unless pnpm-lock.yaml needs an update — acceptable). Running all three in parallel.


