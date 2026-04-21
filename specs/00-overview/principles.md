# Principles

**Purpose.** The non-negotiable design principles that every spec below inherits.

## 1. Household-first

The unit of value is the household, not the individual. Features that only benefit one person are low priority. When a tradeoff exists between individual convenience and household coherence, choose household coherence.

## 2. Four segments, three slices, everywhere

Every feature has a place in the matrix:

|            | Calendar | Summaries / Alerts | Suggestions & Coordination |
|------------|----------|--------------------|----------------------------|
| Financial  |          |                    |                            |
| Food       |          |                    |                            |
| Fun        |          |                    |                            |
| Social     |          |                    |                            |

If a proposed feature does not fit a cell of this matrix, pause and ask whether the matrix is wrong or the feature is wrong.

## 3. Data in → metadata out → memory

Nothing lands in HomeHub without being enriched into the memory graph. There is no "raw-only" data path. This is what lets agents answer questions that span segments.

## 4. Agents propose, humans approve

Background models draft everything: summaries, alerts, suggestions, coordination plans. Anything that spends money, sends a message, or writes to a third-party system requires a human tap. Auto-execution is opt-in per category and off by default.

## 5. Own the data path

Self-hosted Nango brokers third-party connections. Supabase holds the system of record. Railway runs our workers. Models are accessed through OpenRouter so no single vendor lock exists. If a component can be self-hosted without meaningful tradeoff, it is.

## 6. Single source of truth per concept

There is one `household` table. One `person` table. One `event` table. Segment-specific data hangs off these, not parallel copies. Upstream sources are reconciled into these canonical records.

## 7. Production-first

Every shipped piece has: row-level security, error handling, structured logs, and a rollback story. No "we'll add auth later." See `/Users/connorobrien/.claude/CLAUDE.md` for the broader production-first mindset inherited from the author.

## 8. Build in place

No duplicate files. No `_v2` or `.old`. Refactor existing files; rely on git. This applies to specs too: update the right file, don't fork.

## 9. Explicit open questions

Every spec ends with its open questions. An unmade decision is a risk, and a risk that isn't written down is a bigger risk.
