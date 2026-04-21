# Financial — Suggestions & Coordination

**Purpose.** The agentic layer for money.

**Scope.** Proactive suggestions and multi-person money workflows.

## Suggestions (catalog)

| Kind                     | Trigger                                                                       |
|--------------------------|-------------------------------------------------------------------------------|
| `transfer_funds`         | Checking balance > target after factoring upcoming outflows; surplus to savings. |
| `cancel_subscription`    | Subscription unused (no linked activity in N months) or overlapping with another. |
| `settle_shared_expense`  | Pairwise balance between members > threshold.                                 |
| `rebalance_budget`       | Category persistently over/under; propose new target for next month.          |
| `negotiate_bill`         | Price-increase on a subscription + availability of a cheaper tier.             |
| `opt_out_round_up`       | Patterns suggesting the household's round-up/savings rules are miscalibrated. |

Every suggestion has a concrete `preview` describing the exact change.

## Coordination workflows

### Shared-expense settle-up

Roommates / partners can mark transactions as `shared`. A pairwise balance accumulates per `(payer, counterparty)`. When imbalance crosses a threshold, a `settle_shared_expense` suggestion appears with a proposed amount and a "remind" button (sends a drafted message to the counterparty via in-app; v1 does not initiate Venmo/Zelle on their behalf).

### Bill split coordination

When a new recurring expense lands in a shared account, a prompt asks how to split (equal, by member, by %). The split rule is stored on the `transaction.metadata.split_rule` and applied to future matches of the same recurring pattern.

### Approval quorums

Per [`../../05-agents/approval-flow.md`](../../05-agents/approval-flow.md), large transfers require two approvers. The UI shows pending quorum state: "Priya approved — waiting on Alex."

## Execution

All Financial execution happens via:

- Nango proxy to the provider (e.g., Monarch's move-money endpoint where available).
- An outbound email drafted in the member's Gmail as a draft (never sent) for actions that don't have an API path.
- Nothing else. HomeHub does not itself initiate ACH, card charges, or Venmo transfers in v1.

## Dependencies

- [`../../05-agents/suggestions.md`](../../05-agents/suggestions.md)
- [`../../05-agents/approval-flow.md`](../../05-agents/approval-flow.md)
- [`../../03-integrations/budgeting.md`](../../03-integrations/budgeting.md)

## Open questions

- Integration with Venmo/Zelle/etc. for settle-up: post-v1 and only if a household explicitly opts in. Significant risk surface.
- Tax-time aggregation (categorized exports) lives here or in its own seasonal feature? Seasonal feature; defer past v1.
