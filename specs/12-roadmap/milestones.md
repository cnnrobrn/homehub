# Milestones

**Purpose.** Ordered, dependency-aware sequence of build milestones.

**Scope.** Coarse-grained. A detailed schedule lives in project tracking, not here.

## M0 — Scaffolding

- Monorepo with `apps/web`, `apps/workers/*`, `packages/*`.
- Supabase project provisioned; schemas created; pgmq, pgvector, pg_cron enabled.
- Vercel project configured; Railway services stubbed.
- Self-hosted Nango on Railway with one canary connection (Google Calendar).
- OpenRouter account + Kimi K2 reachable via `generate()` helper.
- CI green on an empty repo: lint, typecheck, migration lint.

## M1 — Foundational auth & household model

- Supabase Auth with Google + email magic link.
- Household create / invite / join flows.
- Member + grants model; RLS policies + policy tests.
- Basic settings pages (household, members).

## M2 — First provider end-to-end (Google Calendar)

- Nango integration for Google Calendar.
- `sync-gcal` worker pulling events into `app.event`.
- Enrichment worker on `app.event` → memory graph entries (person nodes for attendees, place nodes).
- UI: unified calendar MVP (no segment filtering yet).

## M3 — Memory network MVP

- Layered memory schema: `mem.node`, `mem.edge`, `mem.episode`, `mem.fact` (+ candidate pool), `mem.pattern`, `mem.rule`.
- Bi-temporal facts (`valid_from`/`valid_to`, `recorded_at`, `superseded_at`).
- Extraction → candidate → reconciliation flow.
- Conflict-resolution policy + supersession pipeline.
- Node document rendering; links panel; evidence drawer.
- `query_memory` tool over MCP, layer-aware with `as_of`.
- Semantic + structural retrieval with hybrid ranking + confidence + conflict penalty.
- Graph-browser page with member controls (confirm/edit/dispute/delete, show evidence).

## M3.5 — First-party chat

- `/chat` page with streaming turns and inline tool cards.
- Foreground agent loop with intent prefilter + slotted context assembly.
- Read-only tool catalog first: `query_memory`, `list_events`, `list_transactions`, `get_pantry`, etc.
- Memory-trace drawer on every assistant message.
- Conversation → episode rollup.
- Member messages → fact candidates via extraction.

## M3.7 — Consolidation & reflection

- Nightly consolidator: episodic → semantic candidates, pattern detection.
- Weekly reflection pass.
- Decay-aware ranking in retrieval.
- Settings: pause memory writes, retention windows, rule authoring.

## M4 — Second surface: Gmail ingestion

- `sync-gmail` worker with labeled ingestion.
- Enrichment classifies receipts, reservations, bills, invites.
- Reservations mirror into the calendar (member-approved).

## M5 — Financial segment

- Nango integration for YNAB (or Monarch).
- `sync-financial` worker.
- `app.transaction`, `app.account`, `app.budget` + UI.
- Reconciler between email receipts and provider transactions.
- Weekly financial summary + budget-over-threshold alert.

## M6 — Food segment

- Meal planner (week grid, drag/drop, dish resolution).
- Pantry + expiration.
- Pantry-diff worker generating draft grocery lists.
- Grocery integration (first provider; Instacart or export-only fallback).
- Weekly food summary + pantry-expiring alert.

## M7 — Fun segment

- Event kinds for trips, reservations, outings.
- Trip parent/child modeling.
- Conflicting-RSVP alerts.
- Outing-idea suggestion generator using graph + free-window detection.

## M8 — Social segment

- Person directory; person-node detail pages.
- Birthday / anniversary materializer.
- Absence + reciprocity detectors.
- Reach-out and gift-idea suggestions.

## M9 — Suggestions, coordination, and chat-driven actions

- Unified suggestions UI with approval flow.
- Multi-approver quorum.
- Auto-approval categories & settings.
- Action-executor with provider-backed actions (grocery order, calendar mirror, Gmail draft).
- Draft-write tools enabled in chat: `draft_meal_plan`, `propose_grocery_order`, `draft_message`, `propose_add_to_calendar`, etc. — all routed through the same approval flow.

## M10 — Operations readiness

- Dashboards, metrics, alerting.
- DLQ tooling.
- Model-usage surface per household.
- Backup + export/import pipeline.
- Security review pass.

## M11 — Private beta launch

- Invite 5–10 target households (Martins-equivalent).
- Weekly review loop on telemetry + qualitative feedback.
- Iterate on suggestions categories driven by usage.

## Dependencies

- [`v1-scope.md`](./v1-scope.md) — what's actually in scope for M11's "v1."
- Each milestone block above points implicitly at the spec subtree it implements.
