---
name: fun
description: Read and manage trips, outings, queued activities, and fun events. Use when the user talks about activities, things to do, trips, vacations, date nights, kids' activities, weekend plans. Bookings and reservations go through suggestions.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, fun, trips, activities]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
---

# Fun

See `_shared`. Fun dated items live in `app.event` with
`segment='fun'` today; confirm whether a dedicated `trip`/`queue_item`
table exists before assuming (grep migrations).
Use the `homehub` CLI.

## When to Use

- Trip planning, outing ideas, queue ("things we want to do").
- Upcoming fun events on the calendar.
- Suggestions for activities given a weekend / budget.

## Read

```bash
homehub calendar list --segment fun --limit 50
```

## Write

- Low-stakes queue additions ("want to try this restaurant"): direct
  memory note or fun calendar event, depending on whether it is dated.
- Reservations, tickets, deposits: `app.suggestion` with
  `segment='fun'`, `kind='propose_book_reservation'`, and a useful
  `preview` payload.

```bash
homehub calendar add --segment fun --kind outing --title "$TITLE" --starts-at "$START_ISO"
homehub suggestions create \
  --segment fun \
  --kind propose_book_reservation \
  --title "$TITLE" \
  --rationale "$WHY" \
  --preview-json "$PREVIEW_JSON"
```

## TripAdvisor look-ups

When the member is scoping out a restaurant, hotel, or attraction, use
the TripAdvisor Content API via the `homehub tripadvisor` surface. It
returns normalized results carrying a canonical `web_url` and (when
`--with-photos` is set) a `photo_url`.

```bash
# Text search with a representative photo
homehub tripadvisor search \
  --query "sushi omakase brooklyn" \
  --category restaurants \
  --with-photos \
  --limit 5

# Near me
homehub tripadvisor search --lat-long "40.7,-74.0" --category attractions

# Deep details + photos for one place
homehub tripadvisor details --location-id 12345 --with-photos
homehub tripadvisor photos  --location-id 12345 --limit 3
homehub tripadvisor reviews --location-id 12345 --limit 3
```

### Rendering in chat

HomeHub's chat surface renders a tiny markdown subset — emit results
this way so the member sees clickable links and photo thumbnails:

- **Clickable link (REQUIRED per TripAdvisor TOS):** `[Grotta Palazzese](https://www.tripadvisor.com/...)` — always use the `web_url` from the CLI response; never a search-engine URL.
- **Inline thumbnail:** `![Grotta Palazzese](https://media.tacdn.com/.../medium.jpg)` — use the `photo_url` field.

Minimum viable render for one result:

```
![Grotta Palazzese](<photo_url>)
**[Grotta Palazzese](<web_url>)** · 4.5★ (1,234 reviews)
Via Narciso 59, Polignano a Mare
```

Attribution rules:

- Every place you surface from TripAdvisor MUST include the `web_url`
  link. That's the TripAdvisor Content API's non-negotiable backlink
  requirement.
- Don't paraphrase reviews without citing them — either link the review
  URL or don't quote from it.
- If `TRIPADVISOR_API_KEY` is not configured in this sandbox, the CLI
  prints a clear error. Tell the member HomeHub needs the key wired in
  the router env; do not fall back to scraping TripAdvisor pages.

## Pitfalls

- Don't double-book — always check existing fun events on the target
  date before proposing.
- Budget check: if the outing has a likely cost, cross-reference
  `financial` skill (budget for `entertainment` category, if present)
  before confirming.
- TripAdvisor `--with-photos` costs an extra HTTP round-trip per result.
  For long lists, prefer `--with-photos` only on the top 3–5 hits, then
  follow up with `homehub tripadvisor photos --location-id ...` on demand.
