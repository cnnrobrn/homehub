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

- [ ] `app.conversation` + `conversation_turn` + `conversation_attachment` migrations — @infra-platform
- [ ] Foreground model routing (OpenRouter, Sonnet-class or equiv) — @memory-background
- [ ] `packages/tools/` — schemas + handlers for read tools: `query_memory`, `list_events`, `list_transactions`, `list_meals`, `get_pantry`, `get_grocery_list`, `get_account_balances`, `get_budget_status`, `list_suggestions`, `get_household_members` — @frontend-chat
- [ ] Intent prefilter + slotted context assembly — @frontend-chat
- [ ] Foreground agent loop (ingest → context → call → tool handling → stream → post-turn writes) — @frontend-chat
- [ ] `/chat` page: history sidebar + streaming thread + tool cards + memory-trace drawer — @frontend-chat
- [ ] `⌘K` floating launcher — @frontend-chat
- [ ] Conversation → episode rollup on natural stopping points — @memory-background
- [ ] Member messages → fact-candidate extraction path — @memory-background

## M3.7 — Consolidation & reflection

- [ ] Nightly consolidator (episodic → semantic candidates; pattern detection) — @memory-background
- [ ] Weekly reflector (`mem.insight`) — @memory-background
- [ ] Decay-aware ranking wired into `query_memory` — @memory-background
- [ ] Settings/memory page: pause writes, retention windows, rule authoring, per-category model budget — @frontend-chat

## M4 — Gmail ingestion

- [ ] Register `google-mail` in Nango (minimum scopes) — @integrations
- [ ] `sync-gmail` worker (watch + history id; server-side filter) — @integrations
- [ ] Attachment handling → Supabase Storage — @integrations
- [ ] Extraction prompt for email (receipt/reservation/bill/invite/shipping) — @memory-background
- [ ] Reservation → calendar-event suggestion (Gmail-sourced) — @memory-background
- [ ] Privacy preview UI for first-time ingestion — @frontend-chat

## M5 — Financial segment

- [ ] Register first budgeting provider in Nango (YNAB preferred) — @integrations
- [ ] `packages/providers/financial` adapter — @integrations
- [ ] `sync-financial` worker — @integrations
- [ ] Reconciler (email-receipt ↔ provider-transaction) — @integrations
- [ ] Financial summary template (weekly/monthly) — @memory-background
- [ ] Financial alerts: `budget_over_threshold`, `payment_failed`, `large_transaction`, `subscription_price_increase`, `account_stale`, `duplicate_charge`, `new_recurring_charge` — @memory-background
- [ ] Subscription detector — @memory-background
- [ ] Financial dashboard + ledger + accounts + budgets + subscriptions pages — @frontend-chat

## M6 — Food segment

- [ ] Register first grocery provider in Nango — @integrations
- [ ] `packages/providers/grocery` adapter — @integrations
- [ ] Meal planner (week grid, drag-drop, dish resolution) — @frontend-chat
- [ ] Pantry + expiration — @frontend-chat
- [ ] `pantry-diff` worker — @memory-background
- [ ] Grocery list drafting + placement flow — @integrations + @frontend-chat
- [ ] Food summary + `pantry_expiring`, `meal_plan_gap`, `grocery_order_issue` alerts — @memory-background
- [ ] Meal swap / grocery order / new-dish suggestions — @memory-background
- [ ] Food draft-write tools in chat: `draft_meal_plan`, `propose_grocery_order` — @frontend-chat

## M7 — Fun segment

- [ ] Trip parent/child modeling — @memory-background
- [ ] Fun calendar + timeline mode — @frontend-chat
- [ ] `conflicting_rsvps` detector — @memory-background
- [ ] Outing-idea + trip-prep + book-reservation suggestions — @memory-background
- [ ] Trip planner UI — @frontend-chat

## M8 — Social segment

- [ ] Person directory + person-node detail pages — @frontend-chat
- [ ] Birthday / anniversary materializer — @memory-background
- [ ] Absence + reciprocity detectors — @memory-background
- [ ] Reach-out + gift-idea + host-back suggestions — @memory-background
- [ ] Gift coordination (multi-member) — @frontend-chat + @memory-background
- [ ] Group nodes (`mem.node type=group`) — @memory-background

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
