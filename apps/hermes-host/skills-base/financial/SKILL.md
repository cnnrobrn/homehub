---
name: financial
description: Read household accounts, transactions, budgets, subscriptions, and balances. Use when the user asks about spending, money, "how much did we spend on …", subscription costs, account balances, budget remaining, or any finance topic. For any write that moves money or cancels a service, propose a suggestion, do not execute.
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

Tables: `transaction`, `account`, `budget`. All scoped on `household_id`.

## Do NOT execute writes

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
