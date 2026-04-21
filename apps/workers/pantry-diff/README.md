# worker-pantry-diff

Reconciles planned meals against the household's pantry inventory and
writes a deficit draft grocery list for the upcoming shopping day.

Triggers:

- **Queue**: `pantry_diff` — fired from database triggers or enqueued
  by the foreground agent / alerts worker when a meal or pantry row
  changes materially. Payload is a `MessageEnvelope` whose
  `entity_id` = household id.
- **Cron** (`src/cron.ts`): Railway schedules this hourly as a
  safety-net sweep — picks up any household whose pantry / meal table
  has mutated since the last run.

Algorithm per household:

1. Enumerate planned meals for the next 7 days.
2. Join each meal's ingredients (`mem.node` type `dish` → `contains`
   edges → `ingredient` nodes, falling back to `metadata.ingredients`
   when the graph is sparse).
3. Subtract the current pantry (`app.pantry_item`) — keyed on
   normalized ingredient name.
4. Upsert an `app.grocery_list` draft for the upcoming Saturday with
   the missing items. Only writes if the set differs from the
   previous draft.

Spec: `specs/06-segments/food/*`, `specs/05-agents/workers.md`.
