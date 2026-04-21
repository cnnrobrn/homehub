# Alerts

**Purpose.** How HomeHub emits event-driven notifications when something warrants attention right now.

**Scope.** Categories, detection, severity, delivery, dismissal.

## Alert categories (v1)

### Financial
- `budget_over_threshold` — category spend crosses 80%/100% of budget.
- `payment_failed` — autopay failure detected in email or via provider.
- `large_transaction` — transaction > household-configured threshold.
- `subscription_price_increase` — recurring charge amount changed.
- `account_stale` — account hasn't synced in > 48h.

### Food
- `pantry_expiring` — item expires within 3 days.
- `meal_plan_gap` — no meal planned for an upcoming slot > 48h out.
- `grocery_order_issue` — substitution or out-of-stock confirmed.

### Fun
- `ticketed_event_tomorrow` — reservation or ticket in the next 24h without prep details.
- `conflicting_rsvps` — two household members RSVP'd yes to overlapping non-joint events.

### Social
- `upcoming_birthday` — birthday of a tracked person within 7 days.
- `long_absence` — tracked person not seen / contacted in threshold (configurable per-person).
- `reciprocity_imbalance` — hosted-by-you vs. hosted-by-them skewed beyond threshold over 90 days.

## Detection

Two patterns:

1. **Event-driven.** Triggered by a row insert/update (e.g., a new transaction triggers budget check).
2. **Scheduled scan.** Cron jobs that scan for time-based conditions (pantry expiry, absence windows, birthday proximity).

Each alert has a detector function in `packages/alerts/<category>.ts` that is unit-tested against fixture data.

## Severity

```
info   → informational; summary-only (does not push)
warn   → worth attention; appears in the segment panel
critical → demands action; appears at the top of the dashboard; optionally pushed
```

Severity is determined by the detector. Members can downgrade / mute categories per household.

## Delivery channels (v1)

- **In-app** — always. `app.alert` rows are streamed to the UI via Supabase realtime.
- **Email** — for `critical` only, digest-batched every 15 minutes.
- **Push** — deferred to post-v1 native/PWA support.

## Dismissal & resolution

- Alerts can be dismissed per-member or per-household.
- Dismissing a recurring alert offers "mute for 7 days" / "mute this category."
- Some alerts auto-resolve when the underlying condition clears (e.g., account resumes syncing).

## Coalescing

Multiple alerts of the same category within a short window coalesce into one (e.g., five items expiring today become one "5 items expire today" alert). Coalescing window and minimum count are per-category configurable.

## Body generation

Simple templates suffice for most alert categories (fast, deterministic). For alerts that benefit from graph context (e.g., "you haven't seen the Garcias in 4 months — last seen at Rick's birthday"), the detector calls Kimi with a prompt that produces a 1–2 sentence body.

## Dependencies

- [`workers.md`](./workers.md)
- [`../06-segments/`](../06-segments/) — each segment's `summaries-alerts.md` lists the segment-specific alerts.
- [`../04-memory-network/retrieval.md`](../04-memory-network/retrieval.md)

## Open questions

- Quiet hours: per-member; deferred delivery (in-app still appears; email/push suppressed). Needs a default (22:00–07:00 household tz).
- False-positive feedback loop: "wasn't useful" button that trains down the relevant detector's threshold. Simple Bayes, per-household. Leaning post-v1.
