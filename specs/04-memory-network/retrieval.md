# Memory Retrieval

**Purpose.** How agents query the memory graph when they need context.

**Scope.** The retrieval strategies, the layer-aware `query_memory` tool surface, and ranking. Covers reads across all four memory layers (working, episodic, semantic, procedural — see [`memory-layers.md`](./memory-layers.md)).

## The three strategies

1. **Structural traversal.** "Given node X, walk edges of type Y up to depth D." Pure SQL. Fast and explainable. Used when the question is shaped (e.g., "who cooked last Tuesday's dinner?").
2. **Semantic search.** Embed the query, pull nearest-neighbor nodes by cosine. Used when the question is fuzzy ("anything about allergies?").
3. **Hybrid.** Semantic seeds the candidate set; structural traversal expands from each seed; results are re-ranked by a combined score.

Default to hybrid. Callers can override.

## The `query_memory` tool (exposed via MCP)

```
query_memory(household_id, query, {
  layers?: ('episodic'|'semantic'|'procedural')[],  // default: all
  types?: string[],              // filter by node type
  include_documents?: bool,      // default true
  include_conflicts?: bool,      // default true — return known contradictions
  max_depth?: int,               // default 2
  limit?: int,                   // default 10
  as_of?: timestamp,             // bi-temporal filter — see temporal.md
  recency_half_life_days?: int   // override default decay
}) → {
  nodes: [...],
  edges: [...],
  facts: [...],                   // atomic facts with evidence + valid_from/valid_to
  episodes: [...],                // time-anchored episodes
  patterns: [...],                // procedural patterns (if layer selected)
  conflicts: [...]                // unresolved or recently-superseded facts
}
```

Returns layer-aware results. Callers can narrow to a single layer when they know the shape of their question: a "what do we know about Sarah" agent asks for `semantic`, a "when did we last see the Garcias" agent asks for `episodic`, a "how does this household run" summarizer asks for `procedural`.

`include_conflicts` is on by default because honest conflict surfacing is a core best-practice (see [`conflict-resolution.md`](./conflict-resolution.md)) — the agent should know when it's relying on contested data.

`as_of` enables bi-temporal queries — see [`temporal.md`](./temporal.md).

## Ranking

Score for a candidate node or fact:

```
score = α * semantic_similarity
      + β * recency_weight(last_reinforced_at)
      + γ * connectivity_weight(edge_count)
      + δ * type_prior(types filter)
      + ε * confidence          (for facts)
      − ζ * conflict_penalty    (for facts with unresolved contradictions)
```

Weights start at `α=0.5, β=0.15, γ=0.1, δ=0.05, ε=0.15, ζ=0.05` and are tunable per agent. A foreground conversational agent weights recency + confidence higher; a biographical-query agent weights connectivity higher; a historical "as-of" agent turns off recency entirely.

Recency uses exponential decay with layer-specific half-lives (see [`consolidation.md`](./consolidation.md)).

## Time travel

Enrichment writes are timestamped; the graph supports an `as_of` parameter that hides nodes/edges created after that timestamp. Useful for "what did we know about X last month?" and for reproducing past summaries.

## Caching

- Query results cached in Redis-compatible store for 5 minutes keyed on `(household_id, query_hash)`.
- Cache invalidated on any graph write in that household (cheap: single key).

## Streaming

For long retrievals (deep traversal with many hops), the tool streams partial results as it discovers them. Clients can stop early once they have enough.

## Dependencies

- [`graph-schema.md`](./graph-schema.md)
- [`../05-agents/model-routing.md`](../05-agents/model-routing.md)
- [`../03-integrations/mcp.md`](../03-integrations/mcp.md)

## Open questions

- Do we need a Graph Neural Network for ranking? No, until we have usage telemetry that justifies it.
- Should we expose raw SQL traversal via MCP? No — only the typed `query_memory` surface. Keeps contracts stable and abuse-resistant.
