# Temporal Memory (Bi-Temporal Facts)

**Purpose.** Every fact in HomeHub's memory is time-aware in two dimensions: when it is/was true in the world, and when we learned it. This is "bi-temporal" modeling, and it is the single most important best-practice we adopt from modern memory systems (Zep/Graphiti pioneered this for agents).

**Scope.** Time columns on facts, soft-supersession, "as-of" queries, and why we never hard-delete facts in the normal path.

## The two time axes

Every `mem.fact` carries:

```
valid_from   timestamptz NOT NULL  # when the fact started being true in the world
valid_to     timestamptz NULL      # when it stopped being true (NULL = still true)
recorded_at  timestamptz NOT NULL  # when we learned / inferred it
superseded_at timestamptz NULL     # when we learned a replacement
```

- **Valid time** answers "was this true on 2026-03-01?"
- **Recorded time** answers "did we know this on 2026-03-01?"

These are independent. We might learn in 2026-04 that Sarah became vegetarian in 2025-11. That's `valid_from=2025-11-01, recorded_at=2026-04-12`.

## Why bi-temporal

Three things are impossible without it:

1. **Retroactive corrections.** "We got Sarah's birthday wrong." The correction should be applied *as of when the fact was recorded*, but the canonical fact should reflect the *actual* birthday. Single-timestamp systems overwrite and lose the history.
2. **"As-of" debugging.** "Why did you suggest X on March 1?" requires replaying the graph with the state we had on March 1 — which means the memory system must know when each fact was *known to us*, not just when it's currently true.
3. **Honest supersession.** When a fact changes ("Mom moved from Boston to Cambridge"), we don't delete the old fact — we close its validity interval. The graph browser can show "Mom lived in Boston 2019–2026, now lives in Cambridge." This is how humans think about facts, and it's crucial for an assistant that reasons across years of household life.

## Supersession, not deletion

The normal path for "a fact changed":

1. New contradicting fact arrives.
2. Conflict resolver runs (see [`conflict-resolution.md`](./conflict-resolution.md)) and decides the new fact wins.
3. Old fact: `valid_to = new fact's valid_from`, `superseded_at = now`, `superseded_by = new fact id`.
4. New fact: inserted with `valid_from` set appropriately, `valid_to NULL`.

The old fact is *still there*. It's just no longer valid. Retrieval defaults to "currently valid" but accepts an `as_of` parameter.

Hard deletion is reserved for explicit user action (see [`user-controls.md`](./user-controls.md)) and treated as a destructive, audit-logged event.

## "As-of" queries

The `query_memory` tool accepts an `as_of` parameter:

```
query_memory(household_id, query, { as_of: '2026-03-01T00:00Z' })
```

Semantically: "what did we know, about facts valid, as of March 1?" Two filters on top of the normal query:

```sql
WHERE valid_from <= as_of
  AND (valid_to IS NULL OR valid_to > as_of)
  AND recorded_at <= as_of
```

This is how we debug "why did you suggest that back then?" and how we produce historical summaries that aren't polluted by facts we learned later.

## Episodes are inherently temporal

Episodic memories (`mem.episode`) are *always* stamped with a specific time. That's what makes them episodic. Their bi-temporal handling is simpler: `occurred_at` (when the event happened) and `recorded_at` (when we ingested it).

## Patterns carry time windows

Procedural memory's `mem.pattern` stores the window over which the pattern was observed:

```
observed_from, observed_to, confidence, last_reinforced_at
```

A pattern that hasn't been reinforced in a while decays; see [`consolidation.md`](./consolidation.md).

## Schema additions

Extends [`graph-schema.md`](./graph-schema.md):

```
mem.fact {
  id, household_id, subject_node_id, predicate, object_value (jsonb), object_node_id?,
  confidence, evidence jsonb,
  valid_from, valid_to,
  recorded_at, superseded_at, superseded_by,
  source_type, source_id
}
```

`predicate` is from a small controlled vocabulary (`avoids`, `prefers`, `has_relationship`, `lives_at`, `born_on`, `works_at`, ...). Open-ended predicates are rejected at write time; new predicates require a migration.

## Dependencies

- [`memory-layers.md`](./memory-layers.md)
- [`extraction.md`](./extraction.md)
- [`conflict-resolution.md`](./conflict-resolution.md)
- [`retrieval.md`](./retrieval.md)

## Open questions

- Do we surface supersession in the graph browser visibly ("Mom lived in Boston, superseded 2026-01") or collapse it into node history? Leaning: visible, because one of HomeHub's superpowers is letting the household see how its own knowledge evolved.
- Fact-level audit (who edited a member-written fact, when) — yes, piggy-back on `audit.event`.
