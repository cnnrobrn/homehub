# HomeHub — Shared Task Board

**Owner:** coordinator. Specialists read, claim, and update status; only the coordinator creates/assigns/retires tasks.

**Status tokens:** `[ ]` pending, `[~]` in-progress, `[r]` ready-for-review, `[x]` done, `[!]` blocked.

**Owners:** `@infra-platform`, `@integrations`, `@memory-background`, `@frontend-chat`.

---

## M0 — Scaffolding

- [x] Create monorepo structure (pnpm workspaces) — @infra-platform (1556d8d)
- [x] Base tsconfig, eslint, prettier, commitlint — @infra-platform (1556d8d)
- [x] GitHub Actions CI: lint, typecheck, format-check, test, migration-lint, web-build, nango-compose-validate — @infra-platform (1556d8d, 55da152, 28ffab3, 579463b, daa6e25)
- [x] Provision Supabase (local scaffold + extensions migration + schemas migration + CI migration-lint; cloud Pro provisioning human-gated) — @infra-platform (55da152)
- [x] Worker service stubs (17 services wired to @homehub/worker-runtime with Dockerfile + railway.toml each; Railway account link human-gated) — @infra-platform (817cfec)
- [x] Self-hosted Nango assets (pinned docker-compose + production railway.toml + runbooks; live deploy human-gated) — @infra-platform (daa6e25)
- [x] OpenRouter `generate()` helper in `packages/worker-runtime` with prompt-cache awareness + JSON-schema validation + fallback + model_calls logging — @infra-platform (28ffab3)
- [x] Vercel project for `apps/web` (Next.js 15 + Tailwind 4 + @supabase/ssr + design-system tokens + /api/health + CI web-build; Vercel link human-gated) — @infra-platform (579463b)

## M1 — Foundational auth & household model

- [x] `app.*` schema migrations (household, member, grants, events, transactions, meals, pantry, grocery_list, alerts, suggestions, actions, summaries, conversation, model_calls, sync.*, audit.*) — @infra-platform (ede1ba4)
- [x] RLS policies + helper functions + at-least-3-tests-per-table (23 test files, 26 tables) — @infra-platform (ede1ba4)
- [x] Supabase Auth: Google + email magic link — @infra-platform (ede1ba4)
- [x] Household create / invite / join flows (`packages/auth-server` + `apps/web/src/app/actions/*`) — @infra-platform (99ba8b5)
- [x] `getHouseholdContext()` helper for server components — @infra-platform (99ba8b5, wrapped in `apps/web/src/lib/auth/context.ts`)
- [x] App shell scaffold (Next.js App Router tree) — @frontend-chat (318a70d: login, invite/[token], onboarding, (app)/layout, dashboard stub)
- [x] Settings: household + members skeletons — @frontend-chat (318a70d). Connections page defers to M2 (where real provider Connect lives); Notifications defers to M9.

## M2 — First provider end-to-end (Google Calendar)

- [x] Register `google-calendar` provider in Nango (runbook at `infra/nango/providers/google-calendar.md`; live registration human-gated) — @integrations (f873e41)
- [x] `packages/providers/calendar` adapter + Nango proxy wrapper — @integrations (f873e41)
- [x] `apps/workers/sync-gcal` with delta sync (sync tokens) — @integrations (f873e41)
- [x] Google push notifications → `webhook-ingest` → `sync_delta:gcal` queue; `/webhooks/nango` handles `connection.created` + watch setup — @integrations (f873e41)
- [x] `enrich_event` queue consumer with deterministic classifier (model-backed path lands in M3 behind the same interface) — @memory-background (e6a8bd4)
- [x] Unified calendar MVP at `/calendar` + dashboard Today strip + realtime subscription — @frontend-chat (a29f8d2)

## M3 — Memory network MVP

- [x] `mem.*` schema migrations (node, edge, episode, fact, fact_candidate, pattern, rule, mention, insight, alias) + bi-temporal columns + pgvector indexes — @infra-platform (ef5d5f0)
- [x] RLS + tests for `mem.*` (10 tables, 15 policies, 33 total pgTAP files in the suite) — @infra-platform (ef5d5f0)
- [x] Extraction prompts v1 (event runtime + event-classifier + node-doc; additional source types in M4/M5) — @memory-background (d5d0d65)
- [x] Enrichment pipeline (Kimi K2 model-backed + deterministic fallback, budget-aware, JSON-schema-validated) — @memory-background (d5d0d65)
- [x] Reconciler: candidate → canonical promotion; conflict routing with destructive-predicate thresholds — @memory-background (d5d0d65)
- [x] Node-regen worker (real handler, manual-notes preservation) — @memory-background (d5d0d65)
- [x] `query_memory` implementation (layer-aware, hybrid ranking with spec-default weights, `as_of`, conflict surfacing) — @memory-background (d5d0d65)
- [x] `mcp-homehub-core` server with `query_memory`, `list_events`, `get_node`, `get_episode_timeline` + member/service token auth (`sync.mcp_token` migration requested) — @integrations (6ffa0f0)
- [x] Graph browser page (search, node doc, facts/episodes/patterns panels, evidence drawer, realtime) — @frontend-chat (61a0f24)
- [x] Per-fact affordances (confirm / edit / dispute / delete via member-sourced candidates) — @frontend-chat (61a0f24)
- [x] Node merge, delete, pin (soft-delete semantics, owner-gated) — @frontend-chat (61a0f24)

## M3.5 — First-party chat

- [x] `app.conversation` + `conversation_turn` + `conversation_attachment` migrations — @infra-platform (ede1ba4, landed with M1-A)
- [x] Foreground model routing (configurable via `HOMEHUB_FOREGROUND_MODEL`, default `anthropic/claude-sonnet-4.5`) — @frontend-chat (9a67912)
- [x] `packages/tools/` — 12 read + 2 direct-write + 8 draft-write-stub tools with Zod schemas + per-segment gating — @frontend-chat (9a67912)
- [x] Intent prefilter + slotted context assembly — @frontend-chat (9a67912)
- [x] Foreground agent loop (ingest → context → call → serial tool handling → stream → post-turn writes) — @frontend-chat (9a67912)
- [x] `/chat` page: history sidebar + streaming thread + tool cards + memory citations — @frontend-chat (9a67912)
- [x] `⌘K` floating launcher — @frontend-chat (9a67912)
- [x] Conversation → episode rollup (`rollup_conversation` queue + handler) — @memory-background (8f720fc)
- [x] Member messages → fact-candidate extraction (`enrich_conversation` queue + handler + whisper mode honored + reconciler deletion branch + `embed_node` queue) — @memory-background (8f720fc)

## M3.7 — Consolidation & reflection

- [x] Nightly consolidator (semantic candidates + temporal/co-occurrence/threshold patterns, budget-gated, per-entity batching) — @memory-background (a8fa1c9)
- [x] Weekly reflector writing `mem.insight` with citation footnote in body_md — @memory-background (a8fa1c9)
- [x] Decay-aware ranking (layer-specific half-lives episodic 14d / semantic 120d / procedural 365d + per-type overrides, pattern decay, old-candidate filter) — @memory-background (a8fa1c9)
- [x] Settings/memory page: pause toggle, retention windows, rule CRUD, model budget + MTD spend, weekly insights feed, forget-everything danger zone — @frontend-chat (df5c939)

## M4 — Gmail ingestion

- [x] Register `google-mail` in Nango (runbook at `infra/nango/providers/google-mail.md`; live registration human-gated) — @integrations (a7d1985)
- [x] `sync-gmail` worker with Gmail watch + history id deltas + feature-flagged persist (default OFF until operator flips) — @integrations (a7d1985)
- [x] Attachment handling → Supabase Storage `email_attachments` bucket with household-scoped RLS — @integrations (a7d1985, migration 0c78ab6)
- [x] Migration 0012 + 0013: `app.email`, `app.email_attachment`, `sync.provider_connection.metadata`, storage bucket + RLS + pgTAP — @infra-platform (0c78ab6)
- [x] Extraction prompt + extractor + `enrich_email` handler (receipt/reservation/bill/invite/shipment all five categories) — @memory-background (2366e32)
- [x] Reservation → `add_to_calendar` `app.suggestion` pipeline (segment heuristic + dedupe) — @memory-background (2366e32)
- [x] Privacy preview dialog with live filter preview + opt-in checkboxes — @integrations (a7d1985)

## M5 — Financial segment

- [x] Register YNAB provider in Nango (runbook `infra/nango/providers/ynab.md`; live reg human-gated) — @integrations (6068252)
- [x] `packages/providers/financial` adapter + `YnabProvider` + milliunit conversion — @integrations (6068252)
- [x] `sync-financial` worker (full/delta with `server_knowledge` cursor, cron at `:00`) — @integrations (6068252)
- [x] Email-receipt ↔ provider-transaction reconciler (Jaro-Winkler similarity, ±$1/±3d tolerances, ambiguous/shadowed/match states) — @integrations (6068252)
- [x] Email-receipt → `app.transaction` write path (prompt bumped to v2) — @memory-background (04c84c1)
- [x] `packages/summaries` + `apps/workers/summaries` deterministic weekly/monthly financial summary — @memory-background (04c84c1)
- [x] `packages/alerts` seven financial detectors + `apps/workers/alerts` worker (dedupe via context jsonb until 0014 migration lands) — @memory-background (04c84c1)
- [x] Subscription detector writing `mem.node type='subscription'` + tagging transactions — @memory-background (04c84c1)
- [x] `/financial` UI: dashboard / transactions / accounts / budgets / subscriptions / calendar / summaries / alerts with realtime refresher — @frontend-chat (c26cb9a)

## M6 — Food segment

- [x] Grocery provider (stub + Instacart adapter gated on operator creds) — @integrations (273ee68)
- [x] `packages/providers/grocery` adapter — @integrations (273ee68)
- [x] Meal planner (week grid with dnd-kit drag-drop) — @frontend-chat (273ee68)
- [x] Pantry + expiration UI — @frontend-chat (273ee68)
- [x] `apps/workers/pantry-diff` worker with pgmq consumer + hourly cron — @memory-background (273ee68)
- [x] Grocery list drafting + placement flow (approve/reject draft actions) — @integrations + @frontend-chat (273ee68)
- [x] Food summary + 3 alert detectors (`pantry_expiring`, `meal_plan_gap`, `grocery_order_issue`) — @memory-background (273ee68)
- [x] Meal-swap / grocery-order / new-dish suggestion generators — @memory-background (273ee68)
- [x] Food draft-write tools (`draft_meal_plan`, `propose_grocery_order`) + direct-write meal/pantry tools — @frontend-chat (273ee68)

## M7 — Fun segment

- [x] Trip parent/child via `app.event.metadata.trip_id` + resolver in `@homehub/enrichment` — @memory-background (28a0da9)
- [x] Fun calendar at `/fun/calendar` (reuses WeekGrid/MonthGrid with segment=['fun']) — @frontend-chat (28a0da9)
- [x] `conflicting_rsvps` + `upcoming_trip_prep` + `ticket_reservation_reminder` detectors — @memory-background (28a0da9)
- [x] Outing-idea + trip-prep + book-reservation suggestion generators — @memory-background (28a0da9)
- [x] Trips list + trip detail + queue + dashboard UIs — @frontend-chat (28a0da9)

## M8 — Social segment

- [x] Person directory + person detail pages deep-linking to `/memory/person/[id]` — @frontend-chat (ae8aeaf)
- [x] Birthday / anniversary materializer worker (`apps/workers/social-materializer` with daily cron) — @memory-background (ae8aeaf)
- [x] Absence + reciprocity + `birthday_approaching` + `conflicting_birthday_without_plan` detectors — @memory-background (ae8aeaf)
- [x] Reach-out + gift-idea + host-back suggestion generators — @memory-background (ae8aeaf)
- [x] Group nodes (`mem.node type='group'`) + group CRUD UI (migration 0014 requested) — @memory-background + @frontend-chat (ae8aeaf)

## M9 — Suggestions, coordination, chat-driven actions

- [ ] Unified suggestion UI w/ approval flow + multi-approver quorum — @frontend-chat
- [ ] Auto-approval categories + settings — @frontend-chat + @memory-background
- [ ] Action executor — provider-backed actions wired — @integrations
- [ ] Draft-write tools in chat (all remaining): `propose_transfer`, `propose_cancel_subscription`, `draft_message`, `propose_add_to_calendar`, `propose_book_reservation`, `settle_shared_expense` — @frontend-chat

## M10 — Operations readiness

- [ ] Dashboards (core health, ingestion, model, per-household) — @infra-platform
- [ ] DLQ tooling (internal UI + alert on non-empty) — @infra-platform
- [ ] Model-usage page per household — @frontend-chat
- [ ] Backup + export/import pipeline — @infra-platform
- [ ] Security review pass — coordinator-led, all agents participate

## M11 — Private beta

- [ ] Invite 5–10 target households — coordinator-led
- [ ] Weekly review loop + telemetry tracking — @infra-platform + coordinator
- [ ] Suggestion-category tuning from usage — @memory-background

---

## Cross-cutting (always-on)

- [ ] Every new table ships with RLS + 3 policy tests — enforced by @infra-platform + coordinator review
- [ ] Every prompt version bump includes eval cases — @memory-background
- [ ] Every new tool in the chat catalog has a Zod schema + unit test — @frontend-chat
- [ ] Every new detector/generator has fixture tests — @memory-background

---

*The coordinator updates this file. Specialists, to claim a task: change `[ ]` to `[~]`, add your owner tag if missing, and (optionally) a short note. When done, change to `[r]` and link the PR.*
