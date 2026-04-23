---
name: suggestions-section
description: Populate data and add tabs/functionality in the Suggestions / Decisions inbox (/suggestions). Use when the user wants to seed draft suggestions, add a new suggestions tab (e.g. history, dismissed, by-segment), wire approval-flow writes, or expose a suggestions tool to the Hermes chat agent.
---

# Suggestions section

Inbox of AI-proposed actions awaiting human approval. Backbone of the
approval flow for every `draft-write` agent tool call.

## Surface area

- Route root: `apps/web/src/app/(app)/suggestions/page.tsx` (single
  page — no SubNav yet; a new tab introduces one).
- Data tables (migration
  `packages/db/supabase/migrations/0007_alerts_suggestions_actions.sql`):
  `app.suggestion`, `app.action`, `app.alert`.
- Approval flow engine: `packages/approval-flow` — defines state machine
  (`pending` → `approved` | `dismissed` | `expired`) and side-effect
  dispatch via `packages/action-executors`.
- Agent tools: `listSuggestions.ts`, plus every `propose*` tool in
  `packages/tools/src/tools/` produces a suggestion.

## Populate data

1. **Local dev seed (SQL)** — append to
   `packages/db/supabase/seed.sql`. Seed `app.suggestion` with a variety
   of `segment` values (`financial`, `food`, `fun`, `social`) and
   `status='pending'`. Each row needs a `proposed_action` JSON payload
   matching one of the tool schemas in `packages/tools/src/tools/` —
   copy from the matching `propose*.ts` Zod schema to stay consistent.
2. **Chat-driven** — every `draft-write` tool call automatically lands
   here. Don't reinvent; add a new `propose*` tool to extend coverage.
3. **Direct path** — server actions under
   `apps/web/src/app/actions/suggestions/` (approve/dismiss) go through
   `packages/approval-flow` — never write `status` directly.

## Add a tab

1. Create `apps/web/src/app/(app)/suggestions/<tab>/page.tsx` (e.g.
   `/suggestions/history` for completed/dismissed).
2. Introduce `apps/web/src/components/suggestions/SuggestionsSubNav.tsx`
   (model on `FinancialSubNav.tsx`) and render it from a new
   `suggestions/layout.tsx`.
3. Filter by `status` or `segment` in the Server Component; reuse
   existing suggestion row components.
4. Add a test.

## Gotchas

- Suggestions have a TTL (`expires_at`) — always filter expired rows
  from the default view.
- Approval side-effects run through the action-executor queue; a UI
  approve must enqueue, not execute inline.
- `proposed_action` is `jsonb` — validate with the tool's Zod schema
  at the executor boundary, never trust the stored shape blindly.
