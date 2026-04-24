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

See `_shared`. **Filter every query by `household_id`.**

## When to Use

- Spending questions, budget status, balances, subscription costs.
- Anything about a transaction, account, or category of spending.
- HomeHub Money setup for accounts, budgets, bills, and subscriptions
  after the onboarding skill has identified the target tab.
- Deciding whether an upcoming event is affordable.

## Read

```bash
# Recent transactions (amount_cents is a signed bigint; divide by 100 for dollars)
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/transaction?household_id=eq.$HOUSEHOLD_ID&order=posted_at.desc&limit=100"
```

Tables: `transaction`, `account`, `budget`, `event`. All scoped on
`household_id`.

## Safe Setup Writes

These are safe setup records when the active member has permission.
They do not move money, cancel services, or contact a provider.

```bash
# Account
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -d '{"household_id":"'"$HOUSEHOLD_ID"'","kind":"checking","name":"Main checking","balance_cents":0,"currency":"USD"}' \
  "$HOMEHUB_SUPABASE_URL/rest/v1/account"

# Budget
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -d '{"household_id":"'"$HOUSEHOLD_ID"'","name":"Groceries","category":"groceries","period":"monthly","amount_cents":80000,"currency":"USD"}' \
  "$HOMEHUB_SUPABASE_URL/rest/v1/budget"

# Bill or autopay reminder
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -d '{"household_id":"'"$HOUSEHOLD_ID"'","segment":"financial","kind":"bill_due","title":"Rent due","starts_at":"2026-05-01T09:00:00Z","metadata":{"amount_cents":250000}}' \
  "$HOMEHUB_SUPABASE_URL/rest/v1/event"
```

Use `account.kind` values exactly:
`checking|savings|credit|investment|loan|cash`. Use `budget.period`
values exactly: `weekly|monthly|yearly`.

## Commitment Writes

**Financial writes are almost always commitments.** Default behavior:

```bash
# Propose a transfer / cancellation / large purchase
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -d "{\"household_id\":\"$HOUSEHOLD_ID\",\"segment\":\"financial\",\"status\":\"pending\",\"proposed_action\":$JSON_PAYLOAD,\"rationale\":\"$WHY\"}" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/suggestion"
```

`proposed_action` shapes match the `propose*` tool schemas in HomeHub
(`proposeCancelSubscription`, `proposeTransfer`). The family approves
in `/suggestions`.

## Pitfalls

- `amount_cents` is signed bigint — negative = outflow. Don't convert
  signs.
- `account.kind` is check-constrained; don't invent new kinds.
- Subscriptions are derived, not a raw table — query `transaction` with
  a recurring filter or read the materialized view if present.
