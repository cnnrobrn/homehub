# Financial — Overview

**Purpose.** Everything HomeHub does with the household's money.

**Scope.** The data we hold, the integrations we rely on, and the non-goals.

## Core entities

- `app.account` — bank accounts, credit cards, investment accounts.
- `app.transaction` — unified ledger across sources.
- `app.budget` — mirrored from the connected budgeting app.
- `app.subscription` — derived entity: a recurring-charge pattern detected in transactions.
- `mem.node type=merchant`, `type=account`, `type=subscription`, `type=category`.

## What we own

- A **unified view** across members' connected accounts.
- Detection of **recurring charges, anomalies, and imbalances**.
- **Shared-expense tracking** when expenses are marked as such.
- A **near-term cash-flow calendar**: pay dates, bills, renewals.

## What we don't own

- **Authoritative categorization** — upstream (YNAB, Monarch) owns that. We mirror.
- **Budget creation** — members create budgets in their upstream tool.
- **Holding funds or moving money directly** — any transfer is a suggestion that the member executes in their bank's app (unless a provider integration explicitly supports a transfer, e.g., Monarch's "move money" feature — still via approval).

## Connection options

See [`../../03-integrations/budgeting.md`](../../03-integrations/budgeting.md). Each member typically connects one budgeting app; Plaid is the fallback.

## Privacy defaults

- Financial segment is the most restrictive. Default grants deny Financial access to children and guests.
- Per-account visibility is tunable (see [`../../02-data-model/row-level-security.md`](../../02-data-model/row-level-security.md)).
- Transaction data is never sent off the HomeHub stack except to OpenRouter for summarization/alert drafting, and only with merchant + amount + category — never account numbers or full memo lines.

## The three slices

- [`calendar.md`](./calendar.md)
- [`summaries-alerts.md`](./summaries-alerts.md)
- [`suggestions-coordination.md`](./suggestions-coordination.md)

## Open questions

- Multi-currency: one currency per household in v1, declared in settings. Cross-currency accounts show a warning.
- Investment-account depth: positions + balances v1? Leaning balances only; positions post-v1.
