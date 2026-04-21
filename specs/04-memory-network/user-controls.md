# User Controls for Memory

**Purpose.** How members see, edit, and delete what HomeHub remembers. This is a **trust-critical** surface: a memory system that the household can't inspect and correct is one the household will stop trusting.

**Scope.** The graph browser's editing affordances, the "why do you think this?" capability, and destructive controls.

## Principles

1. **Transparency.** Every fact the assistant acts on is reachable in the graph browser.
2. **Provenance.** Every fact exposes "why we think this" — the evidence and source rows that led to it.
3. **Editability.** Any fact can be corrected or removed.
4. **Confirmation > Correction.** Members confirming inferred facts is lightweight and common; we design for this because it's cheap trust-building.
5. **Honest deletion.** "Forget this" actually forgets — including from backups per retention policy.

## What the member sees

### Node page

For any entity (person, place, merchant, dish), the member sees:

- The canonical document (generated from facts).
- A **Facts** panel: every fact with predicate, object, confidence, source, `valid_from`/`valid_to`.
- A **Episodes** panel: linked events in time order.
- A **Patterns** panel (where applicable): detected regularities.
- An **Edit notes** area: free-form notes the member can write that are preserved across regeneration.

### Per-fact affordances

For each fact:

- **Confirm** — flags as member-verified; increases confidence; the fact now resists auto-supersession unless member-written.
- **Edit** — opens a form to change object, `valid_from`, etc. Creates a new member-written fact that supersedes the old.
- **Dispute** — marks uncertain. Confidence drops. Fact stays but is de-prioritized by the assistant until reinforced.
- **Delete** — destructive. Removes the fact, its reinforcement history, and attempts to purge from backups (per retention window).
- **Show evidence** — opens the evidence drawer listing every source row that contributed.

### Per-node affordances

- **Merge nodes** — if the household sees two nodes that should be one. Requires confirmation; logged. Edges and facts are unioned; supersession history preserved.
- **Delete node** — cascades to facts and edges linked to it; raw source rows (emails, transactions) survive but lose their graph linkage.
- **Pin node** — marks as important; retrieval weights are boosted; document regeneration runs with more context.

## "Why do you think this?"

Every assistant response that used memory can be expanded to show its evidence. In the chat surface, answers carry a **trace** button; in the dashboard, suggestion cards carry a **provenance** link. Both open the same evidence drawer that lists the facts and episodes the assistant relied on.

This is not a feature for debugging — it's a feature for trust. When the assistant says something surprising or uncomfortable, the member should be able to see where that came from in one tap.

## Pause & forget

Two household-level controls in settings:

- **Pause memory writes.** Extraction and consolidation continue running on raw data but don't write canonical facts. Useful during a transition (e.g., someone moved out and the household wants to re-stabilize before the assistant learns incorrect patterns).
- **Forget period.** Purges episodic memories and derived facts within a time range. Destructive; confirmation + waiting period (24h soft-delete before hard-delete) and full audit logging.

## Export

A member can export **their memory slice** — facts where they're the subject, or facts they authored — as JSON. Same path as household-level export but scoped.

## What the assistant is not allowed to do

- **Silently delete** a member-written fact.
- **Merge nodes** without confirmation.
- **Forget** a destructive-if-wrong fact (allergens, birth dates, addresses) without an audit entry.
- **Hide** low-confidence or conflicting facts from the member's view. Everything is visible; de-prioritization is purely a retrieval/ranking concern.

## Dependencies

- [`conflict-resolution.md`](./conflict-resolution.md)
- [`temporal.md`](./temporal.md)
- [`../09-security/data-retention.md`](../09-security/data-retention.md)
- [`../07-frontend/pages.md`](../07-frontend/pages.md) — the graph browser page.

## Open questions

- "Shared" vs. "member-private" memory: can one member tag a fact as private to themselves within the household? Post-v1; adds complexity. v1 is all-household-visible.
- Do we expose procedural patterns for edit, or only view? Leaning: view + "disable this pattern" toggle in v1; structured editing post-v1.
