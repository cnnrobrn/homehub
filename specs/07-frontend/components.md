# Components

**Purpose.** Reusable UI building blocks shared across segments.

**Scope.** The non-primitive components that encode HomeHub concepts.

## Cross-segment shared

- **`<SegmentNav>`** — the four-tab navigation that appears in the app shell.
- **`<TodayStrip>`** — horizontal scroll of today's events across segments.
- **`<SuggestionCard>`** — renders a `suggestion`: title, rationale, preview, approve/reject.
- **`<AlertBar>`** — stack of active alerts with severity styling.
- **`<EventRow>`** — one line in a calendar or list.
- **`<SummaryCard>`** — renders a `summary.body_md` with a "show more" cutoff.
- **`<PersonChip>`** — compact person reference with avatar; click to open memory node.
- **`<MemoryNodePreview>`** — popover showing a node's header + top links on hover.
- **`<ApprovalQuorum>`** — shows current approval state for multi-approver actions.

## Calendar-family

- **`<CalendarGrid>`** — month/week grid; accepts events array + slot render prop.
- **`<CalendarTimeline>`** — horizontal timeline for multi-day spans.
- **`<EventCreateSheet>`** — bottom sheet with segment-aware form fields.

## Memory browser

- **`<NodeDocument>`** — renders `document_md` with link resolution to other nodes.
- **`<LinksPanel>`** — grouped list of edges with counts.
- **`<EvidenceDrawer>`** — raw-row viewer for a node.

## Meal planner

- **`<WeekMealGrid>`** — drag-and-drop, 7×N slots.
- **`<DishSearch>`** — autocomplete with memory-graph + free text create.
- **`<PantryBadge>`** — "in pantry ✓" indicator next to ingredients.

## Financial

- **`<TransactionRow>`** — merchant, amount, category with inline edit.
- **`<BudgetProgressBar>`** — category progress with threshold colors.
- **`<CashflowChart>`** — upcoming 60 days of projected balance.

## Conventions

- Props are typed (`packages/shared/types`).
- No direct Supabase calls inside components — data comes via props or Server Actions.
- Each component has a Storybook story (if we adopt Storybook; otherwise dedicated test pages).
- Accessibility: every component ships with keyboard + screen reader support; no "visual only" states.

## Dependencies

- [`ui-architecture.md`](./ui-architecture.md)
