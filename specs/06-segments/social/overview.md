# Social — Overview

**Purpose.** The relationships layer. People, reciprocity, and the web of contacts around the household.

**Scope.** The segment that most directly exercises the memory graph. Every person outside the household is a `mem.node type=person`.

## Core entities

- `app.event` with `segment='social'` for birthdays, check-ins, visits.
- `app.person` for household-tracked people (internal + external).
- `mem.node type=person` — the graph node that accumulates history.
- `mem.edge type=attended / related_to / hosted_by / visited`.

## What we own

- A **people directory** with relationship tagging (family, close friends, colleagues, kids' friends' parents, etc.).
- A **social calendar** of birthdays, recurring check-ins, visits.
- **Absence detection**: tracked people not seen/contacted in their configured threshold.
- **Reciprocity watch**: hosted vs. hosted-by imbalance.
- **Context recall**: "what do we know about X?" from every interaction ever linked.

## What we don't own

- Messaging. We draft reach-out text; we don't own the send surface for personal messages.
- A public social network. HomeHub is closed to the household.

## Privacy

- Social is the segment where the memory graph is richest and most personal. Members can delete an individual `person` node; the delete cascades to linked memory edges but leaves raw rows (an email thread, a calendar event) intact — with the person now re-resolved to "unknown."
- Non-household people are never notified of being tracked. This is the household's contact memory; treat it with the discretion of a private address book.

## The three slices

- [`calendar.md`](./calendar.md)
- [`summaries-alerts.md`](./summaries-alerts.md)
- [`suggestions-coordination.md`](./suggestions-coordination.md)

## Open questions

- Group-of-people entities (e.g., "the Garcias") as first-class `mem.node type=group`? Useful; leaning yes in v1.
- Importing from Google Contacts: nice-to-have; gated on clear member consent.
