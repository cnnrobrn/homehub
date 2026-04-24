---
name: financial
description: Read and safely set up household accounts, transactions, budgets, subscriptions, bills, and balances for HomeHub Money. Use when the user asks about spending, money, financials, "set up my financials", account balances, budget remaining, bills, or any finance topic. For broad setup/onboarding of the Money part of HomeHub, load onboarding first, then use this skill for the financial reads and safe setup writes. For any write that moves money or cancels a service, propose a suggestion, do not execute.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, financial, money]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
---

# Financial

See `_shared`. Use the `homehub` CLI; it injects household scope.

## When to Use

- Spending questions, budget status, balances, subscription costs.
- Anything about a transaction, account, or category of spending.
- HomeHub Money setup for accounts, budgets, bills, and subscriptions
  after the onboarding skill has identified the target tab.
- Deciding whether an upcoming event is affordable.

## Read

```bash
# Recent transactions (amount_cents is a signed bigint; divide by 100 for dollars)
homehub money transactions list --limit 100
homehub money accounts list
homehub money budgets list
```

Tables: `transaction`, `account`, `budget`, `event`. All scoped on
`household_id`.

## Safe Setup Writes

These are safe setup records when the active member has permission.
They do not move money, cancel services, or contact a provider.

```bash
# Account
homehub money accounts add --kind checking --name "Main checking" --balance-cents 0 --currency USD

# Budget
homehub money budgets add --name Groceries --category groceries --period monthly --amount-cents 80000

# Bill or autopay reminder
homehub money bills add --title "Rent due" --starts-at 2026-05-01T09:00:00Z --amount-cents 250000
```

Use `account.kind` values exactly:
`checking|savings|credit|investment|loan|cash`. Use `budget.period`
values exactly: `weekly|monthly|yearly`.

## Commitment Writes

**Financial writes are almost always commitments.** Default behavior:

```bash
# Propose a transfer / cancellation / large purchase
homehub suggestions create \
  --segment financial \
  --kind propose_transfer \
  --title "$TITLE" \
  --rationale "$WHY" \
  --preview-json "$PREVIEW_JSON"
```

Preview payloads should match the action executor's expected shape as
closely as possible. The family approves in `/suggestions`.

## Pitfalls

- `amount_cents` is signed bigint — negative = outflow. Don't convert
  signs.
- `account.kind` is check-constrained; don't invent new kinds.
- Subscriptions are derived, not a raw table. Query `transaction` with
  a recurring filter or read the materialized view if present.
