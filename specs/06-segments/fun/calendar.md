# Fun — Calendar

## What shows up

| Event kind      | Source                                                |
|-----------------|-------------------------------------------------------|
| Trip            | Member-entered; multi-day; may bundle sub-events      |
| Concert / show  | Gmail (Ticketmaster, SeatGeek, box offices) + manual  |
| Reservation     | Gmail (OpenTable/Resy/Airbnb/hotels) + manual          |
| Hobby block     | Google Calendar events tagged as hobby or manual       |
| Family outing   | Member-entered; attendees attached                    |
| Match / game    | Calendar + manual                                      |

## Trips

A trip is represented as a parent `event` with `kind='trip'` and sub-events linked via `mem.edge type=part_of`. Sub-events carry their own kinds (flights, hotels, restaurant reservations).

## Display

- Timeline mode is the default for Fun — trips are multi-day and read naturally as horizontal spans.
- Filter by member (who's going).
- "Things I'm looking forward to" pinned list on the Fun dashboard.

## Links out

- Fun events can be two-way synced to Google Calendar (opt-in): new fun events HomeHub creates can mirror into the member's primary calendar.

## Dependencies

- [`overview.md`](./overview.md)
- [`../../03-integrations/google-workspace.md`](../../03-integrations/google-workspace.md)
