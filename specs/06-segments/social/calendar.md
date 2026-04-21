# Social — Calendar

## What shows up

| Event kind         | Source                                                      |
|--------------------|-------------------------------------------------------------|
| Birthday           | Person attribute → recurring annual event                   |
| Anniversary        | Person/couple attribute → recurring annual event            |
| Check-in reminder  | Per-person cadence ("call grandma monthly") → recurring     |
| Visit / dinner     | Calendar event with attendees + in-app creation             |
| Kid's friend event | Calendar event + tagging                                    |

## Generation of recurring social events

- Birthday / anniversary: stored on the `person` node; a materializer job writes future `app.event` rows on a rolling 12-month horizon.
- Check-in cadence: each person can carry `check_in_every` (days). Materializer writes the next reminder after each completed check-in.

## Display

- Month view default (birthdays show as day-markers).
- "Who's coming up" sidebar: next 30 days of birthdays/anniversaries.
- Per-person timeline on the person's memory-node page.

## Dependencies

- [`overview.md`](./overview.md)
- [`../../04-memory-network/graph-schema.md`](../../04-memory-network/graph-schema.md)
