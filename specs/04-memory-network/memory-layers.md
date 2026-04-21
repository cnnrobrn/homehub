# Memory Layers

**Purpose.** HomeHub does not have "one memory." It has four, each with different write paths, retrieval patterns, and lifecycles. This is the standard cognitive-architecture split (working / episodic / semantic / procedural) adapted for a household assistant.

**Scope.** What each layer is, where it lives in Postgres, how it's written, how it's read. Best-practice mapping is called out inline.

## Why layered memory

A single undifferentiated "vector store of everything" is a common beginner mistake. It confuses three things that are actually different:

- **Specific things that happened** ("we had dinner at Giulia's on 2026-04-12, Sarah was there, she ate the vegetarian option").
- **General facts we know** ("Sarah is vegetarian").
- **Patterns / preferences** ("the household eats dinner around 7:30 on weekdays, 8:30 on weekends").
- **The current conversation's context** ("the member just asked about tonight").

Each of these has its own write rules, retrieval needs, and failure modes. Conflating them produces an assistant that recites event minutiae when asked a general question, or forgets stable facts because they're buried under episodic noise.

## The four layers

### 1. Working memory — the current turn

- **What it is:** the context assembled for a single agent turn: the conversation so far, the retrieved relevant memories, the system prompt, the tool schemas.
- **Where it lives:** only in the agent-loop process memory during a turn. Persisted only as conversation history, never as a standalone memory store.
- **Write rule:** not a write target. Anything worth keeping is promoted to another layer.
- **Retrieval:** N/A — it *is* the retrieval destination.
- **Analogue:** the "context window" of the model.

See [`../13-conversation/agent-loop.md`](../13-conversation/agent-loop.md).

### 2. Episodic memory — specific events with time and place

- **What it is:** "something happened" records. Dinner at Giulia's on a specific date. A transaction at Trader Joe's on a specific day. Sarah's visit last Tuesday.
- **Where it lives:** `mem.episode` — a dedicated table, not just `app.event`. `app.event` is the upstream calendar row; `mem.episode` is the enriched memory of it (who attended, what happened, notable facts).
- **Write rule:** produced by the enrichment pipeline for each ingested event / transaction / meal / message. Idempotent per source row.
- **Retrieval:** time-bounded ("what did we do last weekend?"), person-bounded ("every meal with the Garcias"), or semantic ("a vacation near the ocean").
- **Lifecycle:** long-lived but subject to decay-weighted retrieval. Old episodic memories aren't deleted; they're down-ranked unless explicitly queried.

### 3. Semantic memory — stable facts about entities

- **What it is:** facts that are *true now* about a person, place, merchant, dish, or topic. "Sarah is vegetarian." "Mom prefers aisle seats." "Trader Joe's Burlington is 20 minutes away." "The Garcias have two kids, Mateo (7) and Lucía (5)."
- **Where it lives:** `mem.fact` — atomic `(subject, predicate, object)`-shaped rows, plus the aggregated `mem.node.document_md` generated from facts.
- **Write rule:** produced by two paths: (1) extracted from episodic memories during consolidation (see [`consolidation.md`](./consolidation.md)); (2) stated directly by the household ("Sarah is vegetarian").
- **Retrieval:** entity-centric ("what do we know about Sarah?"), or predicate-centric ("who in our household has allergies?").
- **Lifecycle:** stable, but supersedable. When a fact is contradicted, conflict resolution runs (see [`conflict-resolution.md`](./conflict-resolution.md)).

### 4. Procedural memory — household patterns and rules

- **What it is:** repeated-behavior regularities and explicit household rules. "Groceries get ordered on Saturday mornings." "Don't propose restaurants on Tuesdays — that's gym night." "Budget alerts are louder after the 20th of the month."
- **Where it lives:** `mem.pattern` (detected regularities with confidence) and `mem.rule` (member-authored rules).
- **Write rule:** patterns are detected by a nightly consolidator over episodic data; rules are written directly by members in settings.
- **Retrieval:** usually injected into the agent's system context proactively, not retrieved on demand. Procedural memory is what makes the agent *feel* like it knows the household.
- **Lifecycle:** patterns decay if no longer supported; rules are explicit and persist until removed.

## Tables (summary)

```
mem.node            # entities: person, place, merchant, dish, ...
mem.edge            # typed relationships between nodes
mem.episode         # specific events — layer 2
mem.fact            # atomic facts — layer 3
mem.pattern         # detected regularities — layer 4
mem.rule            # member-authored rules — layer 4
```

`mem.node.document_md` is the aggregated view — a node's document is a projection over the facts, episodes, and edges that reference it, regenerated on material change.

## Why atomic facts (not paragraphs)

Storing "Sarah is vegetarian and prefers Italian food and is allergic to peanuts" as one blob hurts us three ways:

1. **Conflict resolution breaks.** If Sarah stops being vegetarian, we can't surgically remove the vegetarian fact without touching the others.
2. **Retrieval is coarse.** Asking "who's allergic to peanuts" shouldn't depend on embedding a whole bio.
3. **Provenance is lost.** Each fact has its own evidence trail (when we learned it, from what source, confidence).

So `mem.fact` stores atomic triples with rich metadata. The node document is regenerated *from* facts, not *as* facts.

## Retrieval across layers

Layer-aware retrieval is the norm:

- A question like "what do we know about Sarah?" → semantic (facts) first, episodic second for color.
- A question like "when did we last see the Garcias?" → episodic only.
- A question like "what's our weekly grocery pattern?" → procedural first.

See [`retrieval.md`](./retrieval.md) for the tool surface.

## Dependencies

- [`concept.md`](./concept.md) — the higher-level concept.
- [`extraction.md`](./extraction.md) — how writes to episodic and semantic layers are produced.
- [`consolidation.md`](./consolidation.md) — how episodic rolls up into semantic and procedural.
- [`conflict-resolution.md`](./conflict-resolution.md) — how contradictions are resolved.
- [`temporal.md`](./temporal.md) — time-awareness across layers.
- [`user-controls.md`](./user-controls.md) — how members see and edit memory.

## Open questions

- Do we expose all four layers in the graph browser, or hide procedural behind a "settings" tab since it feels less like a "memory"? Leaning: show all four, with procedural presented as "what we've learned about how you run things."
- Should working memory across turns within a single conversation be persisted long-term? Yes — conversations themselves become episodic memory after they end (see [`../13-conversation/conversations-data-model.md`](../13-conversation/conversations-data-model.md)).
