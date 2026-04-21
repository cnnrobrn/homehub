# Social — Suggestions & Coordination

## Suggestions (catalog)

| Kind              | Trigger                                                                            |
|-------------------|------------------------------------------------------------------------------------|
| `reach_out`       | Person's absence threshold crossed                                                 |
| `gift_idea`       | Upcoming birthday + memory graph hints (interests, prior gifts, avoids)           |
| `host_back`       | Reciprocity imbalance + attendees' availability + household hosting frequency     |
| `introduce`       | Two people in graph who seem likely to hit it off (cautious; post-v1)             |
| `plan_reunion`    | Group hasn't gathered in N months                                                  |

## Coordination

### Hosting coordination

When a `host_back` suggestion is approved, the workflow:

1. Proposes candidate dates using free windows from household members' calendars.
2. Drafts an invite message in the host member's Gmail as a draft (never sends).
3. On reply, surfaces in the Social panel to confirm/adjust.
4. Once confirmed, creates an event with attendees; Food segment is notified for meal planning.

### Check-in coordination

Per-person check-in cadence is household-wide. If "Mom" is set to "call monthly," HomeHub surfaces a reminder and lets any member mark it complete, which resets the timer.

### Gift coordination

For a shared gift, multiple members can collaborate on a single suggestion — comments, budget, who's buying. Financial-segment integration records the shared expense.

## Execution

- `draft_message` — Gmail draft.
- `add_to_calendar` — with optional attendees notified via email draft.
- `mark_interaction` — simple log write on the `person` node's timeline.

## Dependencies

- [`../../05-agents/suggestions.md`](../../05-agents/suggestions.md)
- [`../../04-memory-network/retrieval.md`](../../04-memory-network/retrieval.md)
