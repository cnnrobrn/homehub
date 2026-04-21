# HomeHub Specifications

This directory is the detailed design for HomeHub, a household AI control panel. It expands on the top-level [`spec.md`](../spec.md) into per-topic documents that the team can build against.

## How to navigate

Specs are grouped by concern and numbered so the order is meaningful. Read top-to-bottom to onboard; jump by topic when implementing.

- [`00-overview/`](./00-overview/) — Vision, principles, personas, glossary.
- [`01-architecture/`](./01-architecture/) — System shape, stack, data flow, environments.
- [`02-data-model/`](./02-data-model/) — Postgres schema, household model, row-level security.
- [`03-integrations/`](./03-integrations/) — Nango, MCP, and each third-party provider.
- [`04-memory-network/`](./04-memory-network/) — Enrichment pipeline and Obsidian-style graph.
- [`05-agents/`](./05-agents/) — Model routing, background workers, summaries/alerts/suggestions.
- [`06-segments/`](./06-segments/) — Financial, Food, Fun, Social — each with the three slices.
- [`07-frontend/`](./07-frontend/) — Next.js UI on Vercel.
- [`08-backend/`](./08-backend/) — API, workers on Railway, queues.
- [`09-security/`](./09-security/) — Threat model, auth, retention.
- [`10-operations/`](./10-operations/) — Observability and deployment.
- [`11-testing/`](./11-testing/) — Testing strategy.
- [`12-roadmap/`](./12-roadmap/) — Milestones and v1 scope.
- [`13-conversation/`](./13-conversation/) — First-party chat surface (ask HomeHub), agent loop, tool catalog.

## Conventions

- Each spec document opens with **Purpose**, **Scope**, and **Dependencies** so readers know what they're getting before diving in.
- Implementation-ready details (schemas, endpoint shapes, job names) live in the lowest-level doc, not the overview.
- Open questions are called out explicitly in each doc rather than silently assumed.
- When a decision is pending, prefer "leaning X because Y" over leaving it blank.

## Status

These are living documents. Update the relevant spec when a decision changes; do not leave contradictions between `spec.md` and files under `specs/`.
