# Glossary

**Purpose.** Shared vocabulary. If two specs use the same word, it means the same thing here.

## Domain terms

- **Household** — The unit of value. A set of `member`s who have opted into sharing with one another. Can be a family, a couple, a group of roommates, or a single person.
- **Member** — A user who belongs to a household. A user can belong to multiple households.
- **Person** — A human entity in the memory graph, whether or not they are a HomeHub member. Grandma who doesn't use the app is still a `person`.
- **Segment** — One of the four top-level domains: Financial, Food, Fun, Social.
- **Slice** — One of the three views every segment exposes: Calendar, Summaries/Alerts, Suggestions/Coordination.
- **Event** — A time-anchored item. Unifies calendar events, bill due dates, planned meals, birthdays.
- **Memory node** — A concept in the graph (person, place, merchant, meal, topic). Each node has a canonical markdown document.
- **Memory edge** — A typed relationship between two nodes.
- **Enrichment** — The background pass that extracts metadata from an inbound item and writes nodes/edges.
- **Suggestion** — A proposed action drafted by a background model. Not executed without human approval unless auto-approved for its category.
- **Coordination** — A multi-person workflow in HomeHub (who cooks, who pays, who picks up).

## Infrastructure terms

- **Nango** — Self-hosted OAuth/integration broker. All third-party tokens live there.
- **MCP** — Model Context Protocol. How HomeHub exposes capabilities to models and how it integrates with sources Nango doesn't cover.
- **OpenRouter** — Model gateway. Default background model is Kimi K2.
- **Provider** — A third-party source (Google Calendar, Gmail, Monarch, Instacart). Brokered by Nango or fronted by an MCP server.
- **Sync worker** — A Railway worker that pulls from a provider into Supabase.
- **Enrichment worker** — A Railway worker that consumes new rows and writes to the memory graph.
- **Agent worker** — A Railway worker that runs summarization/alerting/suggestion jobs.

## Conventions

- "User" and "member" are used interchangeably when context makes it obvious; prefer "member" in database/data-model specs.
- "Event" is overloaded. Disambiguate with "calendar event" vs. "bill event" vs. "system event (enqueued job)" when needed.
- Dates in specs use ISO 8601 (`2026-04-20`), never natural language.
