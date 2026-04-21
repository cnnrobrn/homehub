# Memory Network — Concept

**Purpose.** Explain the *what* and *why* of the Obsidian-style memory graph before diving into schema or pipeline.

## The intuition

A household accumulates context: "Mom prefers an aisle seat." "The Garcias are vegetarian." "We usually spend $180 at Trader Joe's on Saturdays." "Leo's soccer season ends in June."

Any one of those facts is useful only if an agent can find it when it matters. Traditional databases don't surface them; chat logs bury them. HomeHub's memory graph is a structured, browsable store where every fact has a canonical home, every entity has a document, and bidirectional links let agents traverse from one fact to related ones.

## The Obsidian analogy

- Every **entity** (a person, place, merchant, dish, topic) has a single **markdown document** — its canonical node.
- Documents **link** to each other via explicit edges (typed), so "Trader Joe's" links to every `grocery_run`, which links to the `meal`s they enabled, which link to `people` who ate them.
- The graph is **household-scoped**. Two households that both shop at Trader Joe's have two separate "Trader Joe's" nodes. This is deliberate: it prevents cross-household leakage and lets each household carry its own context (e.g., "the Trader Joe's in Burlington vs. in Cambridge").
- Nodes are **human-browsable**. A member can open `Person/Mom` and read the current document, see linked events, see linked transactions. It's literally Obsidian for your household's shared memory.

## What's in a node

Every node document has:

- A short **header** with name, type, and quick facts.
- An **auto-summary** regenerated on a schedule from the linked content (e.g., for a person: "seen 14 times in the last 90 days; last visit 2026-04-12; vegetarian; prefers aisle seat").
- A **links** section: edges out, grouped by type.
- An optional **manual notes** section the household can edit directly.

The node document is stored as `mem.node.document_md` and is what agents pass around as context. The document is a *projection* over the underlying atomic facts, episodes, and edges — it is regenerated from them, never the other way around. See [`memory-layers.md`](./memory-layers.md).

## Layered, not monolithic

"Memory graph" is shorthand. HomeHub actually has four memory layers, each with its own write rules and retrieval patterns:

- **Working memory** — the current turn's context.
- **Episodic memory** — specific events with time and place.
- **Semantic memory** — stable atomic facts about entities.
- **Procedural memory** — household patterns and member-authored rules.

See [`memory-layers.md`](./memory-layers.md) for the full model. Every fact is also bi-temporal (valid-in-world + known-to-us) — see [`temporal.md`](./temporal.md). Contradictions are resolved via a provenance-weighted policy, not by overwrite — see [`conflict-resolution.md`](./conflict-resolution.md).

## Node vs. row

`app.event`, `app.transaction`, and similar are the *factual rows*. `mem.node` is the *entity they talk about*. Relationship:

- A transaction at Trader Joe's is a row. "Trader Joe's" is a node. An edge `mentions(transaction → merchant_node)` links them.
- Enrichment creates or updates the node and the edge. The row itself is unchanged.

## Why graph + embeddings both

- **Graph** answers structural queries: "every meal where the Garcias ate with us." Exact, explainable, fast when you know what you're looking for.
- **Embeddings** answer semantic queries: "when have we talked about allergies?" Fuzzy, surfaces things you didn't explicitly link.

Agents retrieve with both: structural graph traversal seeds the candidate set, embeddings re-rank, and the top-k nodes' documents go into the model's context. See [`retrieval.md`](./retrieval.md).

## Lifecycle

- **Write** during enrichment (see [`enrichment-pipeline.md`](./enrichment-pipeline.md)).
- **Read** by summary/alert/suggestion agents and by the frontend's graph browser.
- **Update** when new facts arrive; document is regenerated from the latest linked content.
- **Prune** on member-initiated deletion or retention expiry.

## What the graph is not

- **Not a dump of every raw item.** Raw items live in their own tables (`app.*`). The graph is the entity-and-relationship layer *on top*.
- **Not a chat memory.** Agents can query it; they don't write freeform conversation logs into it.
- **Not public.** Strictly household-scoped; no cross-household sharing or discovery.

## Dependencies

- [`memory-layers.md`](./memory-layers.md) — the four-layer model.
- [`temporal.md`](./temporal.md) — bi-temporal facts.
- [`extraction.md`](./extraction.md) — atomic-fact extraction.
- [`consolidation.md`](./consolidation.md) — episodic → semantic rollup.
- [`conflict-resolution.md`](./conflict-resolution.md) — handling contradictions.
- [`user-controls.md`](./user-controls.md) — member-facing memory affordances.
- [`enrichment-pipeline.md`](./enrichment-pipeline.md) — orchestration.
- [`graph-schema.md`](./graph-schema.md) — tables.
- [`retrieval.md`](./retrieval.md) — how agents query memory.

## Open questions

- Do we surface a "graph browser" UI in v1, or is the graph initially agent-only? Leaning: ship the browser. Obsidian-style visibility is part of the product thesis, not a nice-to-have.
