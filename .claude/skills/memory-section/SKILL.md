---
name: memory-section
description: Populate data and add tabs/functionality in the Memory section (/memory). Use when the user wants to seed nodes/facts/episodes/patterns/rules, add a new memory category or tab (e.g. timeline, audit), wire a server action for memory edits, or expose a memory tool to the Hermes chat agent.
---

# Memory section

The "what we know" graph. Shows nodes, facts, episodes, patterns, rules
with conflict detection and needs-review gates.

## Surface area

- Route root: `apps/web/src/app/(app)/memory/` —
  `page.tsx` plus a dynamic `[type]/` segment that drives the
  category rail.
- Category rail: `apps/web/src/components/memory/MemoryCategoryRail.tsx`
  and `NodeTypeRail.tsx`. Adding a new node category means extending both
  the rail and the dynamic `[type]` handler.
- Data tables:
  - `mem.node`, `mem.alias`, `mem.edge`, `mem.mention`, `mem.episode`
    (migration
    `packages/db/supabase/migrations/0010_mem_core.sql`).
  - `mem.fact`, `mem.fact_candidate`, `mem.pattern`, `mem.rule`,
    `mem.insight` (migration `0011_mem_facts_patterns_rules.sql`).
- Components: `apps/web/src/components/memory/*` — `FactsPanel`,
  `EdgesPanel`, `EpisodesPanel`, `NodeList`, `NodeHeader`,
  `FactEditDialog`, `NodeMergeDialog`, `ManualNotesEditor`,
  `MemorySearch`, `EvidenceDrawer`, `PinButton`, `NeedsReviewToggle`.
- Agent tools: `queryMemory.ts`, `rememberFact.ts`, `getNode.ts`,
  `getEpisodeTimeline.ts`, `createRule.ts`.
- Runtime: `packages/query-memory` (hybrid retrieval used by the chat
  agent and the MCP memory tool).

## Populate data

1. **Local dev seed (SQL)** — carefully. Memory rows have vector
   embeddings (`mem.node.embedding`, `mem.fact.embedding`). Seeding rows
   without embeddings works for UI smoke tests but breaks retrieval.
   Prefer running a seed script that calls the reflector/consolidator
   workers instead of raw SQL for realistic data.
2. **Chat-driven** — `remember_fact` (tool) is the canonical path. The
   reflector worker (`apps/workers/reflector`) and consolidator
   (`apps/workers/consolidator`) extract facts from conversation turns.
3. **Direct backfill** — for imports, write to `mem.fact_candidate` and
   let the approval flow promote them; do not bypass into `mem.fact`
   without a provenance record in `audit.event`.

## Add a tab / category

- **New category rail entry**: extend `MemoryCategoryRail.tsx` and ensure
  `apps/web/src/app/(app)/memory/[type]/page.tsx` handles the slug. The
  `[type]` param is validated against a union — update the validator.
- **New top-level tab** (e.g. `/memory/timeline`, `/memory/audit`):
  introduce `MemorySubNav.tsx` alongside the category rail, or nest
  under `/memory/<tab>/page.tsx`. Keep access behind the existing gate.
- Add a test — the memory section has the densest test surface
  (`FactRow.test.tsx`, `NodeHeader.test.tsx`, `MemorySearch.test.tsx`,
  `EvidenceDrawer.test.tsx`); mirror those.

## Gotchas

- Conflicts are surfaced via `ConflictBadge`; any new fact write must
  go through the conflict-detection path in `packages/query-memory` —
  don't bypass.
- `mem.node.node_type` is check-constrained; new node types require a
  migration + reflector schema update + UI rail + query-memory handling.
- The memory graph has household-scoped RLS; always pass `household_id`
  in server-component queries even when using the service client.
- Never delete memory rows directly — mark `deleted_at` (soft delete)
  so audit + provenance survive.
