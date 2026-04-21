# HomeHub — Shared Task Board

**Owner:** coordinator. Specialists read, claim, and update status; only the coordinator creates/assigns/retires tasks.

**Status tokens:** `[ ]` pending, `[~]` in-progress, `[r]` ready-for-review, `[x]` done, `[!]` blocked.

**Owners:** `@infra-platform`, `@integrations`, `@memory-background`, `@frontend-chat`.

---

## M0 — Scaffolding

- [ ] Create monorepo structure (pnpm workspaces) — @infra-platform
- [ ] Base tsconfig, eslint, prettier, commitlint — @infra-platform
- [ ] GitHub Actions CI: lint, typecheck, migration-lint (unit/integration to be added later) — @infra-platform
- [ ] Provision Supabase project (staging); enable `pgvector`, `pgmq`, `pg_cron`, `pg_trgm`, `uuid-ossp` — @infra-platform
- [ ] Provision Railway project; create worker service stubs per `specs/05-agents/workers.md` — @infra-platform
- [ ] Deploy self-hosted Nango on Railway (pinned version, isolated Postgres) — @infra-platform
- [ ] OpenRouter account; `generate()` helper in `packages/worker-runtime` with prompt-cache awareness — @infra-platform
- [ ] Vercel project for `apps/web`; wire Supabase env — @infra-platform

## M1 — Foundational auth & household model

- [ ] `app.*` schema migrations (household, member, grants, events, transactions, meals, pantry, grocery_list, alerts, suggestions, actions, summaries) — @infra-platform  (blocked-by: M0)
- [ ] RLS policies + helper functions + at-least-3-tests-per-table — @infra-platform
- [ ] Supabase Auth: Google + email magic link — @infra-platform
- [ ] Household create / invite / join flows (server actions) — @infra-platform
- [ ] `getHouseholdContext()` helper for server components — @infra-platform
- [ ] App shell scaffold (Next.js App Router tree per `specs/07-frontend/ui-architecture.md`) — @frontend-chat  (blocked-by: auth schema)
- [ ] Settings: household, members, connections, notifications pages (skeleton) — @frontend-chat

## M2 — First provider end-to-end (Google Calendar)

- [ ] Register `google-calendar` provider in Nango — @integrations  (blocked-by: M0 Nango, M1 schema)
- [ ] `packages/providers/calendar` adapter + Nango proxy wrapper — @integrations
- [ ] `apps/workers/sync-gcal` with delta sync (sync tokens) — @integrations
- [ ] Google push notifications → Pub/Sub → `webhook-ingest` → enrichment queue — @integrations
- [ ] Enrichment trigger on `app.event` insert + `enrich_event` queue consumer — @memory-background  (blocked-by: `mem.*` schema)
- [ ] Calendar MVP page (unified grid, no segment filter yet) — @frontend-chat

## M3 — Memory network MVP

- [ ] `mem.*` schema migrations (node, edge, episode, fact, fact_candidate, pattern, rule, mention, insight, alias) + bi-temporal columns — @infra-platform
- [ ] RLS + tests for `mem.*` — @infra-platform
- [ ] Extraction prompts v1 (event, email, transaction, meal, conversation) — @memory-background
- [ ] Enrichment worker (Kimi K2 via OpenRouter, JSON mode, schema-validated) — @memory-background
- [ ] Reconciler: candidate → canonical promotion; conflict routing — @memory-background
- [ ] Node-regen worker (debounced) — @memory-background
- [ ] `query_memory` implementation (layer-aware, hybrid ranking, `as_of`, conflict surfacing) — @memory-background
- [ ] `mcp-homehub-core` server with `query_memory`, `list_events`, `get_node`, `get_episode_timeline` — @integrations  (blocked-by: query_memory)
- [ ] Graph browser page (search, node doc, facts/episodes/patterns panels, evidence drawer) — @frontend-chat
- [ ] Per-fact affordances (confirm / edit / dispute / delete / show evidence) — @frontend-chat
- [ ] Node merge, delete, pin — @frontend-chat

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
