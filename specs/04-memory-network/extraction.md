# Fact Extraction

**Purpose.** How raw inbound data becomes atomic, reconciled facts in the semantic layer.

**Scope.** The extraction pipeline's contract, the atomicity rule, and reconciliation. Complements [`enrichment-pipeline.md`](./enrichment-pipeline.md), which covers the orchestration/infrastructure; this document covers the *semantics* of what we extract and how.

## The atomicity rule

A fact is **atomic** if it cannot be usefully split. Each fact is shaped like:

```
(subject, predicate, object[, qualifier])
```

Examples:

- `(person:Sarah, avoids, "peanuts", qualifier:{severity:"allergic"})`
- `(person:Sarah, is, "vegetarian", qualifier:{since:"2025-11"})`
- `(person:Mom, lives_at, place:"Cambridge MA")`
- `(household, budget_alert_threshold_cents, 50000, qualifier:{segment:"financial"})`

Not atomic (and therefore not allowed):

- ❌ `(person:Sarah, bio, "vegetarian, peanut-allergic, lives in Boston")`

The atomicity rule is what makes every downstream concern (conflict resolution, retrieval, provenance, user editing) tractable.

## Extraction contract

The extraction prompt's JSON response is:

```json
{
  "episodes": [
    {
      "occurred_at": "2026-04-12T19:30Z",
      "summary": "Dinner at Giulia's with the Garcias. Sarah ate the vegetable lasagna.",
      "participants": ["person:Sarah", "person:Mateo", ...],
      "mentions_facts": ["f_001", "f_002"]
    }
  ],
  "facts": [
    {
      "id": "f_001",
      "subject": "person:Sarah",
      "predicate": "is",
      "object": "vegetarian",
      "confidence": 0.7,
      "evidence": "chose the vegetarian option; prior meals also vegetarian",
      "valid_from": "inferred"
    },
    ...
  ]
}
```

Facts carry:

- **Confidence** — 0.0–1.0, produced by the model. Thresholded per predicate; low-confidence facts stay as "candidate" and don't enter the canonical layer until reinforced.
- **Evidence** — a short natural-language justification plus a pointer to the source row (`source_type`, `source_id`).
- **Temporal hints** — when the fact became true if known; otherwise "inferred" (defaults to `recorded_at`).

## Two-stage write

Extracted facts do **not** go straight into `mem.fact`. They pass through a reconciliation stage:

```
extracted → candidate pool → reconciliation → canonical mem.fact
```

### Stage 1 — candidate pool

`mem.fact_candidate` holds newly extracted facts with their confidence and evidence. They do not affect retrieval yet.

### Stage 2 — reconciliation

The reconciler (a worker) runs after each extraction batch, and evaluates each candidate against existing canonical facts:

1. **New fact.** Subject/predicate has no canonical value. Promote candidate to canonical if confidence ≥ threshold.
2. **Reinforcement.** Candidate agrees with canonical. Increment reinforcement count and `last_reinforced_at`. Boost confidence (capped).
3. **Conflict.** Candidate contradicts canonical. Route to the conflict resolver (see [`conflict-resolution.md`](./conflict-resolution.md)).
4. **Low confidence + no support.** Leave as candidate; may be promoted later if reinforced.

Candidates expire after 90 days if never promoted or reinforced.

## Why not extract straight into facts

Naive systems extract and write in one pass. This produces two pathological outcomes:

- **Thrash.** Every mention extracts the same fact as "new," bloating the store.
- **Premature canonicalization.** A one-time joke ("Mom's going vegan, ha") becomes a canonical fact.

The candidate-pool + reinforcement pattern (inspired by Mem0 and similar systems) absorbs noise and lets low-confidence signals accumulate before committing.

## What we extract per source type

| Source            | Episodes? | Facts?                                                      |
|-------------------|-----------|-------------------------------------------------------------|
| Calendar event    | Yes       | Rare (maybe `person:X, attended:Y_on_date` — not a semantic fact) |
| Email (receipt)   | Yes       | Merchant facts (`merchant:X, sells_category:Y`)              |
| Email (reservation) | Yes     | Place facts (`place:X, located_at:Y`)                       |
| Transaction       | Yes       | Merchant attributes; subscription price facts                |
| Meal              | Yes       | Dish attributes; person-preference inferences (cautious)     |
| Conversation turn | Sometimes | Frequent — this is where most semantic facts originate       |
| Member-entered    | No        | Direct facts (high confidence)                               |

Note: facts extracted from conversation are especially valuable and especially risky (people say things loosely). Confidence thresholds for conversation-sourced facts are higher.

## Structured-output discipline

All extraction calls the model in JSON mode with a schema. Schema violations are treated as extraction failures, not attempts to "parse" freeform text. This is the only reliable way to keep a multi-thousand-row/day pipeline honest.

## Idempotency

- Extraction keyed on `(source_type, source_id, prompt_version)`.
- Reconciliation keyed on `(candidate_id)`.
- Both are safe to re-run.

## Dependencies

- [`enrichment-pipeline.md`](./enrichment-pipeline.md) — the orchestration container.
- [`memory-layers.md`](./memory-layers.md) — where extracted facts go.
- [`temporal.md`](./temporal.md) — time columns on each fact.
- [`conflict-resolution.md`](./conflict-resolution.md) — how contradictions are handled.
- [`consolidation.md`](./consolidation.md) — how reinforcement accumulates over time.

## Open questions

- Per-predicate confidence thresholds: start with a flat 0.7, then tune from data. Highly-destructive-to-get-wrong predicates (allergen) use a higher bar (0.9) *and* prefer member confirmation before promotion.
- Do we extract "negative facts" (Sarah did *not* eat the pork)? Yes, but only if explicitly stated — never inferred from absence.
