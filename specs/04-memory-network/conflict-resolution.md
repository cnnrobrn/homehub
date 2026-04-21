# Conflict Resolution

**Purpose.** What happens when a new fact contradicts a known fact.

**Scope.** The policy, the provenance-weighted decision rule, and the safeguards that keep the assistant honest.

## The problem

Facts change. Sarah becomes vegetarian, then later adds fish. Mom moves. A subscription price changes. A preference wasn't real, just said in passing. The memory system must handle these gracefully, preserving history while keeping canonical state accurate.

Naive systems overwrite. HomeHub does not.

## Conflict detection

During reconciliation of a candidate fact (see [`extraction.md`](./extraction.md)), a candidate is flagged as **conflicting** if:

1. Same `(subject, predicate)` exists with a different `object`, OR
2. The predicate is marked "single-valued" (e.g., `lives_at`, `birth_date`) and a canonical value already exists, OR
3. The candidate's `object` semantically contradicts the canonical (same predicate, related objects — e.g., `avoids: peanuts` vs. `eats_regularly: peanuts`).

Semantic contradiction requires the extractor to declare the conflict explicitly; we don't freeform-reason about it downstream.

## Resolution policy

The policy is a fixed ordering of rules. The first matching rule wins.

### Rule 1 — Member-written trumps model-inferred

If the canonical fact was written directly by a household member, a model-inferred candidate does **not** supersede it automatically. Instead, the candidate is parked with a "possible contradiction" flag on the member's canonical fact, surfaced in the graph browser. The member chooses.

### Rule 2 — High-confidence explicit trumps low-confidence inferred

If the candidate is confidence ≥ 0.9 and its source is an explicit statement (email body, conversation turn, member entry), and the canonical is low-confidence inferred, the candidate supersedes.

### Rule 3 — Recency + reinforcement

If neither of the above applies, the fact with more recent `last_reinforced_at` wins — with a minimum-reinforcement bar (single observation doesn't flip a well-established fact). Specifically: the new candidate supersedes only if it has at least 3 independent observations or a single explicit statement.

### Rule 4 — Destructive predicates require member confirmation

For predicates tagged `destructive_if_wrong` (`avoids` for allergens, `birth_date`, `lives_at`), conflict resolution never auto-supersedes. The member is prompted.

### Rule 5 — Everything else is parked

If no rule applies cleanly, the candidate is parked alongside the canonical with `conflict_status = unresolved`. The graph browser shows both; the assistant's retrieval prefers the canonical but is aware of the contradiction and can mention it when asked.

## Supersession mechanics

When a candidate wins:

1. The canonical fact gets `valid_to = new fact's valid_from`, `superseded_at = now`, `superseded_by = new fact.id`.
2. The new fact is inserted with appropriate `valid_from`, `valid_to = NULL`.
3. Both remain queryable via `as_of` (see [`temporal.md`](./temporal.md)).
4. An audit event is written with both fact ids and the rule that fired.

## Safeguards

- **Oscillation guard.** A predicate-subject pair cannot flip more than once per 24 hours by auto-resolution. A second conflict within that window forces manual review.
- **Cascading check.** If superseding a fact would invalidate linked patterns or nodes, the consolidator re-runs on the affected entity.
- **Transparent surface.** The graph browser's person/node page shows supersession history. A fact that flipped last week is visible, not hidden.

## Member override

In the graph browser, any fact can be:

- **Confirmed** (locks it as member-written; rule 1 applies henceforth).
- **Edited** (creates a new member-written fact, supersedes the old).
- **Deleted** (destructive — see [`user-controls.md`](./user-controls.md)).
- **Marked uncertain** (reduces confidence, flags for reinforcement).

## What the assistant says

When a retrieval hits a fact with `conflict_status = unresolved` or recent supersession, the assistant is expected to handle it honestly:

- "You'd mentioned Sarah is vegetarian, though the Tuesday receipt suggests she's eating fish again — want me to update that?"

This honesty is enforced by retrieval including conflict metadata when present, not by hoping the model notices. See [`retrieval.md`](./retrieval.md).

## Dependencies

- [`extraction.md`](./extraction.md)
- [`temporal.md`](./temporal.md)
- [`user-controls.md`](./user-controls.md)
- [`memory-layers.md`](./memory-layers.md)

## Open questions

- Three-observation threshold in rule 3: tune from data.
- Do we auto-merge two separately-created person nodes that turn out to be the same person? Only with member confirmation — silent entity merges are a trust-destroying bug.
