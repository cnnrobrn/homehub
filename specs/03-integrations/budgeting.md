# Budgeting Integrations

**Purpose.** How HomeHub connects to financial data: budgeting apps first, aggregators as fallback.

**Scope.** Supported providers, sync semantics, transaction reconciliation, and account visibility.

## Providers

**Tier 1 (preferred, if available):**
- **Monarch Money** — direct API via Nango where Nango supports it; otherwise fall back to OFX export if the household uses the Monarch export.
- **YNAB** — OAuth 2 via Nango, official API is stable and rich.
- **Copilot** — likely needs a manual export flow via `mcp-ingest` (no public API today).

**Tier 2 (fallback aggregator):**
- **Plaid** — when the household's budgeting app of choice has no API, connect bank accounts directly via Plaid Link (proxied through Nango/our backend; Plaid items stored with member-scoped ownership).

**Tier 3:**
- **Manual entry / CSV upload** via `mcp-ingest` for institutions nothing else covers.

Only one "primary" financial source is recommended per member to keep reconciliation tractable.

## Sync

- Poll hourly; providers push notifications are unreliable and we don't need real-time.
- Backfill: 12 months on initial connection.
- Cursor per `sync.provider_connection` keyed on the provider's continuation token.

## Normalization

All providers land in `app.transaction`. Mapping differences:

| Source   | Amount sign          | Categories               | Merchant name   |
|----------|----------------------|--------------------------|-----------------|
| YNAB     | signed (debit neg)   | YNAB categories          | payee           |
| Monarch  | signed               | Monarch categories       | merchant        |
| Plaid    | unsigned + type      | Plaid categories         | name            |
| Email    | derived from receipt | enrichment-inferred      | parsed          |

A single `transaction_category_map` table maps each provider's category vocabulary to HomeHub's canonical set.

## Account sync

- `app.account` mirrors balances + metadata per underlying account.
- Stale-check: if `last_synced_at` > 24 hours, UI shows a warning and offers re-sync.
- Balances are point-in-time; we do not store historical balance series in v1 (can be reconstructed from transactions if needed).

## Reconciliation (email receipt ↔ budget app)

Email-derived transactions arrive faster; budgeting-app transactions arrive canonical but delayed. Reconciler job runs hourly:

1. For each email-derived transaction in the last 30 days without a `matched_transaction_id`:
2. Look for a budgeting-app transaction in the same household, within ±$1.00 and ±3 days at a merchant whose name fuzzy-matches.
3. If exactly one candidate: link and mark email version as `shadowed` (retained for receipt attachment but hidden from totals).
4. If ambiguous: leave both visible, flag in UI as "possible duplicate."

## Budgets

- Pull category budgets from the provider where available (YNAB, Monarch).
- Unified `app.budget` rows; HomeHub doesn't let users *create* budgets v1 — they live upstream.
- Per-budget progress is computed on read for the unified UI.

## Shared-expense handling

- Every transaction has an `owner_member_id`.
- Households can tag transactions as `shared` → triggers the shared-expenses coordinator (see [`../06-segments/financial/suggestions-coordination.md`](../06-segments/financial/suggestions-coordination.md)).
- For roommates, shared transactions are typically from a "shared" account, which is granted `read/write` to all housemates via `account_grant`.

## Dependencies

- [`nango.md`](./nango.md)
- [`../02-data-model/schema.md`](../02-data-model/schema.md)
- [`../06-segments/financial/`](../06-segments/financial/)

## Open questions

- Should HomeHub ever modify upstream budgets (e.g., "suggest increasing groceries budget")? Leaning: propose, don't write.
- Currency: v1 USD only. Multi-currency and FX conversion is post-v1.
