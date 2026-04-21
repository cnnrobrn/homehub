# Fun — Summaries & Alerts

## Summaries

### Weekly
- What the household did (outings, hobby time, trips).
- What didn't happen (cancelled, skipped).
- Next week's preview.

### Monthly
- Time spent on each hobby/topic.
- Venues visited.
- Upcoming trips at a glance.

## Alerts

| Detector             | Severity | Trigger                                                       |
|----------------------|----------|---------------------------------------------------------------|
| `ticketed_event_tomorrow` | info | Upcoming ticket / reservation without prep details           |
| `trip_prep_window`   | info     | Trip within 7 / 3 / 1 days — reminds of prep tasks           |
| `conflicting_rsvps`  | warn     | Two members RSVP-yes to overlapping non-joint events          |
| `dormant_hobby`      | info     | Previously frequent hobby hasn't appeared in 60+ days         |

## Notes

- `conflicting_rsvps` uses both HomeHub events and Gmail-detected invite responses.
- `dormant_hobby` is explicitly low-severity; it's a reflection, not a nag.

## Dependencies

- [`../../05-agents/summaries.md`](../../05-agents/summaries.md)
- [`../../05-agents/alerts.md`](../../05-agents/alerts.md)
