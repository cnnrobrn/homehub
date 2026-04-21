# Data Flow

**Purpose.** Trace the end-to-end path of data through HomeHub for each canonical scenario.

**Scope.** Walks the same pipeline for different input types so shared machinery and divergent bits are both clear.

## The shared pipeline

Every inbound item follows five steps. Differences per provider are in the "extract" and "normalize" stages.

1. **Ingest** — a sync worker fetches from a provider (via Nango or MCP) or receives a webhook.
2. **Normalize** — provider-specific adapter converts the payload into a canonical HomeHub row (a calendar event, a transaction, a receipt, etc.).
3. **Persist** — insert into Supabase with `household_id`, `source_id` (provider identifier), and `source_version` (idempotency key).
4. **Enrich** — a Postgres trigger enqueues an enrichment job on `pgmq`. A worker picks it up, calls Kimi via OpenRouter, extracts metadata, and writes nodes/edges into the memory graph.
5. **React** — schedulers and triggers fan out to summary, alert, and suggestion jobs that read the graph and write their outputs back into Supabase for the UI.

## Scenario A — A new Google Calendar event appears

1. Google sends a push notification (or polling worker fires) → Nango → sync worker (`sync-gcal`).
2. Worker fetches changed events via Nango proxy; normalizes each into the `events` table (`segment: null` initially — classified in enrichment).
3. Insert trigger enqueues `enrich_event` on `pgmq`.
4. Enrichment worker extracts: people (attendees → `person` nodes), place, topic, segment classification, related entities. Writes graph edges.
5. Conflict-detector alert worker runs on the household's event stream; if this event overlaps with another member's, emits an alert row.
6. Frontend, subscribed to `alerts` and `events` for this household, updates in place.

## Scenario B — A new email with a receipt

1. Gmail watch webhook → Nango → `sync-gmail` worker receives a message id; fetches headers and body through Nango.
2. Worker stores raw message metadata in `emails` and a pointer to the attachment in Supabase Storage.
3. Insert trigger enqueues `enrich_email`.
4. Enrichment worker classifies: is this a receipt? a reservation? a bill? If receipt, extract merchant, amount, date, items; create a `transaction` row (marked `source: email`, linked to the message) and link to merchant/people nodes.
5. If the email represents a reservation, a `calendar event` is created in HomeHub's canonical `events` table and optionally mirrored to the member's Google Calendar via a suggestion ("add Friday's reservation to your calendar?").
6. The transaction may de-duplicate against a budgeting-app transaction that lands later; the reconciler handles this in a separate job (see [`03-integrations/budgeting.md`](../03-integrations/budgeting.md)).

## Scenario C — A new budgeting-app transaction

1. `sync-monarch` (or equivalent) worker pulls recent transactions via Nango proxy on a schedule.
2. Normalizes into `transactions`.
3. Enrichment extracts merchant, category, household member responsible, links to any receipt-derived transaction for de-dup.
4. Budget-progress alert worker recomputes category spend; if over threshold, emits alert.
5. Weekly financial summary worker reads the week's transactions + graph context; generates the weekly digest.

## Scenario D — Meal planned in-app

1. Member edits the meal planner UI; frontend calls a server action that inserts into `meals`.
2. Insert trigger enqueues `enrich_meal`.
3. Enrichment extracts ingredients, dish node, cuisine, estimated cost, nutritional profile (cached from a food DB).
4. Pantry-diff worker recomputes required groceries = (meal ingredients) − (pantry inventory).
5. Grocery suggestion worker offers to generate an order when the week's cumulative diff crosses a threshold or when the scheduled grocery day approaches.

## Scenario E — Member approves a suggestion

1. Suggestion appears in the UI with an "Approve" action.
2. Approve hits a server action that inserts an `actions` row (`status: pending`, `action_type: place_grocery_order`).
3. Action worker on Railway claims the row, calls the provider via Nango (or an MCP tool), records the result in `action_results`.
4. On success, downstream rows update (e.g., an `order` row appears; the grocery calendar event lands; a confirmation email is expected, which loops back into Scenario B).

## Idempotency

Every provider-originated row carries `(source_id, source_version)`. Writes are upserts keyed on `source_id`. Re-running a sync is safe.

Every enrichment job keys on `(entity_type, entity_id, enrichment_version)`. Re-running enrichment is safe and is how we reprocess when the prompt or schema changes.

## Backpressure

- `pgmq` queues have max-in-flight limits per worker class.
- Providers with rate limits have per-household token buckets stored in Redis-compatible state (likely Upstash; see [`stack.md`](./stack.md)).
- If OpenRouter returns a rate-limit error, the enrichment worker backs off with jittered retry and preserves job order per household.

## Dependencies

- [`system-overview.md`](./system-overview.md)
- [`../04-memory-network/enrichment-pipeline.md`](../04-memory-network/enrichment-pipeline.md)
- [`../08-backend/queues.md`](../08-backend/queues.md)

## Open questions

- Where does the dedup between email-derived and budgeting-app-derived transactions live — in enrichment or in a separate reconciler? Leaning separate reconciler for clarity.
- Do we store raw email bodies forever or hash-and-drop after enrichment? See [`../09-security/data-retention.md`](../09-security/data-retention.md).
