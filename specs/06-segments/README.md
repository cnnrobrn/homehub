# Segments

**Purpose.** One directory per segment (Financial, Food, Fun, Social), each with the same shape.

**Scope.** Segment-specific specs. Cross-segment patterns live in `05-agents`.

## Shape

Every segment has:

- `overview.md` — what the segment is, the data it owns, and the key entities.
- `calendar.md` — the Calendar slice.
- `summaries-alerts.md` — the Summaries/Alerts slice.
- `suggestions-coordination.md` — the Suggestions & Coordination slice.

Segments with more surface area add specialized docs (e.g. Food has `meal-planning.md` and `pantry-and-grocery.md`).

## Segments

- [`financial/`](./financial/)
- [`food/`](./food/)
- [`fun/`](./fun/)
- [`social/`](./social/)

## Why this structure

The three-slice shape mirrors the product. If we keep it consistent, we can:

- Assign an engineer to "the Calendar layer" or "the Summaries layer" horizontally rather than per-segment.
- Generalize shared components (calendar rendering, alert bar) across segments.
- Spot missing functionality (a segment without a Suggestions doc is a red flag).
