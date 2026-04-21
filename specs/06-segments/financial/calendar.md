# Financial — Calendar

**Purpose.** Time-anchored view of the household's money obligations.

**Scope.** What appears on the Financial calendar and where each item comes from.

## What shows up

| Event kind                 | Source                                           |
|----------------------------|--------------------------------------------------|
| Bill due date              | Derived from recurring transactions / provider data |
| Subscription renewal       | Derived from subscription detection              |
| Pay day                    | Derived from recurring inbound transactions      |
| Autopay scheduled          | Email parse + provider data                      |
| Investment contribution    | Recurring outbound to investment account         |
| Tax deadline               | Jurisdiction calendar (household-configurable)   |
| Large expected outflow     | Member-entered (trip deposit, tuition payment)   |

All render into `app.event` with `segment = 'financial'` and distinctive `kind` values.

## Derivation

- **Subscription renewal detector:** runs weekly on `app.transaction`; groups by merchant + approximate amount + cadence; emits subscription events for the next cycle and creates/updates `mem.node type=subscription`.
- **Bill due detector:** combines biller-domain email signals with recurring-transaction timing to project the next due date.
- **Pay-day detector:** identifies periodic inbound transactions; emits forecast pay events up to 90 days out.

Derived events carry `provider = 'derived'` and an `evidence` pointer into the memory graph. If a derivation is wrong, the member can reject; the detector's confidence threshold lifts for that pattern in that household.

## Display

- Filterable by account and by member.
- Color-coded by `kind`: outflows red, inflows green, neutrals gray.
- Overlay with daily balance projection if the household has a primary checking account connected (line chart beneath the calendar grid).

## Sync with upstream calendars

- Financial events are **not** written back to Google Calendar by default. Members can opt in per category.
- Tax deadlines and member-entered large outflows can optionally sync out — useful to get a heads-up in the member's primary calendar.

## Dependencies

- [`overview.md`](./overview.md)
- [`../../02-data-model/schema.md`](../../02-data-model/schema.md) — `app.event`, `app.transaction`.
- [`../../03-integrations/budgeting.md`](../../03-integrations/budgeting.md)

## Open questions

- Cash-flow projection horizon: 30 / 60 / 90 days? Default 60; configurable.
- Show pending credit-card transactions as distinct from posted? Yes — clarity wins over simplicity here.
