# Social — Summaries & Alerts

## Summaries

### Weekly
- Who you saw / interacted with.
- Upcoming social obligations.
- Noteworthy gaps (tracked people you haven't contacted).

### Monthly
- Heatmap-style view: each tracked person's contact frequency.
- Reciprocity snapshot: hosted / hosted-by ratio.
- New people added to the graph this month.

## Alerts

| Detector             | Severity | Trigger                                                     |
|----------------------|----------|-------------------------------------------------------------|
| `upcoming_birthday`  | info/warn| 14 / 7 / 2 / 1 day windows                                  |
| `long_absence`       | info     | Tracked person crosses their per-person threshold           |
| `reciprocity_imbalance` | info  | 90-day hosted imbalance > threshold                         |
| `unresolved_person`  | info     | New attendee / email contact not yet matched to a node      |

## Context pointers

- `upcoming_birthday` pointer includes gift-history edges for the person, to seed the gift-idea suggestion.
- `long_absence` pointer includes last-N interactions as a reminder of context for reaching out.

## Dependencies

- [`../../05-agents/summaries.md`](../../05-agents/summaries.md)
- [`../../05-agents/alerts.md`](../../05-agents/alerts.md)
