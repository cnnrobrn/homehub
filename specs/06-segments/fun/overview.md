# Fun — Overview

**Purpose.** Leisure, hobbies, outings, trips, and media queues.

**Scope.** The lightest of the four segments in data volume, one of the most valuable for coordination.

## Core entities

- `app.event` with `segment = 'fun'` and varied `kind` (outing, trip, concert, hobby_block).
- `mem.node type=topic` for hobbies ("climbing", "Formula 1").
- `mem.node type=place` for venues and destinations.
- Informal "queues": books/shows/games to do — represented as topic-linked todo-ish items in v1 (a simple list).

## What we own

- A **leisure calendar** across the household: trips, events, reservations, hobby time.
- **Memory of what you've done**: where you went, what you liked, who was there.
- **Suggestions that fit**: ideas for free windows informed by preferences and history.

## What we don't own

- **Ticket inventory.** We detect reservations and tickets from email but don't host them.
- **Hobby content.** No library of recipes-for-leisure.

## Integration touch-points

- Gmail: reservations, tickets, booking confirmations.
- Calendar: trips, events, hobby-time blocks.
- Financial: trip-cost tracking when tagged.
- Social: attendees on fun events cross into Social memory.

## The three slices

- [`calendar.md`](./calendar.md)
- [`summaries-alerts.md`](./summaries-alerts.md)
- [`suggestions-coordination.md`](./suggestions-coordination.md)

## Open questions

- Do watch/read/play queues become their own feature or live as topic-attached notes? Leaning notes in v1, feature if usage warrants.
- Trip-planning as a multi-event bundle: design the model now even if we don't ship the deep UI in v1.
