# Data Retention

**Purpose.** How long each class of data lives, and when/how it's removed.

**Scope.** Per-class retention, member-initiated deletion, household-initiated deletion, backups.

## Per-class retention defaults

| Class                              | Default retention          | Configurable? |
|------------------------------------|----------------------------|---------------|
| Raw email bodies                   | 30 days                    | yes (off → 0 days post-enrichment) |
| Email headers + metadata           | 2 years                    | yes           |
| Calendar events                    | 5 years                    | yes           |
| Transactions                       | 7 years (tax-friendly)     | yes           |
| Meals / pantry / grocery           | 2 years                    | yes           |
| Memory nodes + edges               | indefinite while household exists | yes      |
| Audit log                          | 2 years                    | no (compliance) |
| Model call logs                    | 90 days                    | no            |
| Supabase Storage attachments       | matches parent row's retention | yes       |

The default rationale: long enough to be useful for summaries and comparisons; short enough to be a responsible default.

## Member-initiated deletion

- **Delete a single row** (transaction, meal, event): immediate soft-delete, hard-delete after 30 days.
- **Delete a person (memory node):** cascades to edges; raw rows referencing the person survive but lose the link.
- **Disconnect a provider:** stops future syncs; historical data is *not* deleted automatically. A separate "delete my provider-X data" action performs the purge.
- **Leave a household:** removes the member row + grants. Historical data authored by the member stays in the household (owners can delete if desired).

## Household-initiated deletion

- Soft-delete with a 30-day tombstone.
- After window: cascade delete across `app.*`, `mem.*`, `sync.*`; audit logs survive per compliance defaults.

## Backups

- Supabase automatic backups: enabled per tier.
- Weekly logical dump stored in a separate Storage bucket with lifecycle policy (30-day retention).
- Deletion honors backups: deleted data is purged from the active DB; backup windows mean it may persist for up to the backup retention. This is documented to members.

## Model-provider data

- OpenRouter's configured providers are selected for **no-training** and limited retention.
- We do not send raw email bodies to the model; we send extracted + redacted summaries.
- Model inputs and outputs are stored only in `model_calls` (logs) at summary granularity, not verbatim.

## Export

- Household owner can request a full export: JSON dumps of `app.*` and `mem.*` + a zip of attachments.
- Asynchronous; delivered via signed Storage link within 24h.

## Dependencies

- [`threat-model.md`](./threat-model.md)
- [`auth.md`](./auth.md)

## Open questions

- Do we provide member-scoped exports (my data only) in addition to household-scoped? Useful; leaning yes.
- Right-to-be-forgotten requests that affect non-members (e.g., "please delete all references to me" from someone who is a graph node in someone else's household): procedural flow needed; handled via support in v1.
