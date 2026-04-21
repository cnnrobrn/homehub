# Consolidation

**Purpose.** How HomeHub rolls episodic memories up into semantic facts and procedural patterns over time, and how memories decay when not reinforced.

**Scope.** The nightly consolidation job, the consolidation prompts, and decay semantics. Analogous to "sleep" in biological memory systems — off-peak reflection that compresses and generalizes.

## Why consolidation

Without consolidation, the semantic layer is a lagging indicator: it only grows from the bits of explicit semantic content the extractor happened to catch. Most household knowledge lives implicitly across many episodes. "Sarah is probably vegetarian" isn't in any single email; it's in the pattern across fifteen dinners.

The consolidator is the job that notices those patterns and proposes semantic or procedural facts.

## When it runs

- **Nightly consolidation** (default 3am household tz): full pass over the prior 30 days of episodic memory with attention weighted toward recency.
- **On-demand consolidation:** triggered when a node accumulates enough new episodes that its summary document is out of date (debounced; see [`enrichment-pipeline.md`](./enrichment-pipeline.md)).

## What it produces

### Semantic-fact candidates

For each entity with meaningful new episodic activity, the consolidator prompts Kimi with:

- The entity's current canonical facts.
- Recent episodes (bounded window).
- A question: *"Are there new stable facts implied by these episodes that aren't already known, or contradictions to known facts?"*

Output is a list of candidate facts (same shape as [`extraction.md`](./extraction.md)) with consolidation-specific evidence pointers ("inferred from episodes E_123, E_145, E_189"). Candidates go through the standard reconciliation flow.

### Procedural patterns

A structural pass detects regularities without involving the model:

- **Temporal regularities.** "Grocery orders are placed on Saturday 83% of the time."
- **Co-occurrence.** "When Priya cooks, the Garcias are involved 60% of their visits."
- **Thresholds.** "Average dinner duration at Giulia's: 2h15m."

These are written to `mem.pattern` with `observed_from`, `observed_to`, `confidence`, `sample_size`.

### Node-document regeneration

Consolidation also triggers regeneration of affected node documents. The prompt sees: facts (authoritative), recent episodes (color), patterns (habits) — and produces a coherent short document.

## Decay

Memories don't delete, but they fade:

- **Episodes** carry a `recency_weight` recomputed on each retrieval call: `exp(-age_days / half_life)`. Half-life defaults vary by entity type (person: 180 days; merchant: 90; place: 365).
- **Patterns** carry `last_reinforced_at`. If a pattern isn't reinforced within a threshold (typically 3× its natural period), its confidence decays toward zero. At decay threshold, the pattern is archived (still queryable "as of" past dates, but excluded from default retrieval).
- **Candidate facts** expire after 90 days unless reinforced.

Decay is a ranking-time adjustment, not a write-time delete. The data is preserved for time-travel queries and for accurate historical summaries.

## Reflection turns

Beyond the structural consolidator, HomeHub runs a weekly **reflection** that is more abstract:

- Prompt: *"What did this household learn about itself this week? What patterns emerged or broke?"*
- Output: a short "insights" node attached to a weekly timestamp, visible in the memory browser.

This is where the assistant gets genuinely interesting — it notices things the household hasn't verbalized ("The household orders takeout on nights Priya works late; consider prepping Wednesday lunches Sunday.").

Reflection output is **not** treated as canonical fact. It's visible, editable, and can be promoted to a rule by the household if they agree.

## Cost control

Consolidation is the second-largest model spend after extraction. Controls:

- Batch by entity (one call covers all recent episodes for a node).
- Per-household nightly budget ceiling.
- Skip entities with fewer than N new episodes since last consolidation.
- Skip the weekly reflection entirely if the household has paused consolidation.

## Idempotency

- Nightly consolidation is keyed on `(household_id, consolidation_date, prompt_version)`. Safe to rerun.
- Node-document regeneration is keyed on `(node_id, content_hash)` — a regeneration that would produce the same document is a no-op.

## Dependencies

- [`memory-layers.md`](./memory-layers.md)
- [`extraction.md`](./extraction.md)
- [`conflict-resolution.md`](./conflict-resolution.md)
- [`enrichment-pipeline.md`](./enrichment-pipeline.md) — worker infrastructure.

## Open questions

- Reflection frequency: weekly vs. biweekly. Start weekly; dial down if repetitive.
- Do insights from reflection get a separate node type or attach to a `topic`? Leaning separate type `insight` with validity windows, so they can be superseded the following week.
