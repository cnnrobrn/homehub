# Google Workspace — Calendar & Gmail

**Purpose.** How HomeHub reads and writes Google Calendar and Gmail per member.

**Scope.** OAuth scopes, sync model, and what we extract.

## Scopes

Minimum viable scopes — we ask for the least possible:

- Gmail: `gmail.readonly`, `gmail.labels`, `gmail.modify` (for labeling only — never delete).
- Calendar: `calendar.readonly`, `calendar.events` (for write-back when a member accepts a suggestion that mirrors a HomeHub event).

All scopes are explained to the member on connection and re-consented on scope change.

## Connection model

- Per member, not per household. Each adult connects their own account.
- A single member can connect multiple Google accounts (personal + work) — each is a distinct `sync.provider_connection`.
- Children do not connect Google; their events land in HomeHub's native calendar.

## Calendar sync

- Initial sync: last 90 days + next 365 days.
- Delta sync: Google sync tokens. Push notifications via Pub/Sub for near-real-time updates.
- Normalization into `app.event` with:
  - `segment = null` initially; assigned during enrichment based on event content.
  - `provider = 'gcal'`, `source_id = google_event_id`, `source_version = etag`.
  - Attendees resolved into `app.person` during enrichment (not at sync time).
- Write-back: only when a HomeHub suggestion explicitly asks the member to add/modify. Never auto-write.

## Gmail sync

- Initial sync: last 180 days of messages matching a narrow filter (see "What we ingest" below).
- Delta sync: history id (Gmail's watch mechanism) for near-real-time.
- We do not fetch full inbox bodies. We apply server-side Gmail filters to reduce volume and enrich only relevant messages.

### What we ingest

We label and ingest:

- Receipts (regex on merchant names + keywords + sender allowlist).
- Reservations (OpenTable, Resy, Airbnb, hotels, airlines).
- Bills / statements (known biller domains).
- Event invites (`.ics` attachments).
- Shipping notifications (tracking numbers).

Everything else stays in Gmail untouched. A Gmail label `HomeHub/Ingested` is applied to anything we successfully parsed so the member can audit.

### Storage of bodies

- Headers + first-2KB of body cached for 30 days for debugging.
- Full body fetched on demand for enrichment; not persisted beyond enrichment unless flagged.
- Attachments (receipts as PDF/image) stored in Supabase Storage with household-scoped RLS.

## Attendee → person resolution

- Match by email → existing `app.person.metadata.emails` → household's person nodes.
- If no match, create new `person` with `display_name = name_or_email` and metadata `{ unresolved: true }`. Members can resolve in UI.

## Privacy

- Gmail ingestion is opt-in per category. A member can turn off "receipts" without turning off "reservations."
- The first-time ingestion shows a preview of what will be labeled and ingested before it happens.

## Dependencies

- [`nango.md`](./nango.md) — transport.
- [`../04-memory-network/enrichment-pipeline.md`](../04-memory-network/enrichment-pipeline.md) — what happens after sync.
- [`../09-security/data-retention.md`](../09-security/data-retention.md) — how long we keep what.

## Open questions

- iCal / Outlook sync: post-v1. Worth designing the calendar schema to accept them today even though we won't implement.
- Attachment de-dup: same receipt PDF across two members' email. Hash-based de-dup keyed to `(household_id, content_hash)`.
