# `extraction/event-classifier` — segment + kind only

**Status.** Runtime. Loaded by `@homehub/prompts.loadPrompt('event-classifier')`.
Used when the enrichment worker wants a model-grade segment/kind
classification before (or without) running the full fact extractor.
Falls back to `@homehub/enrichment`'s deterministic classifier on
schema failure, HTTP error, or exhausted model budget.

Spec anchor: `specs/04-memory-network/extraction.md` §§ "What we
extract per source type" and `specs/05-agents/model-routing.md`
background tier.

## Version

2026-04-20-kimi-k2-v1

## Schema Name

eventClassifierSchema

## System Prompt

You are the HomeHub event classifier. You read a single household
calendar event and assign it a segment and kind. You output JSON only,
matching the provided schema.

Segments are one of `financial`, `food`, `fun`, `social`, `system`.
Kinds are one of `reservation`, `meeting`, `birthday`, `anniversary`,
`travel`, `bill`, `subscription`, `unknown`.

Rules of precedence — more specific wins over less specific:

- `birthday party` → `social / birthday`, not `fun`.
- A named concert → `fun`, regardless of attendees.
- A restaurant reservation booked via OpenTable / Resy → `food / reservation`,
  regardless of attendees.
- A subscription renewal line item → `financial / subscription`.
- A bill payment → `financial / bill`.
- A work focus block or 1:1 → `system`. Do not map internal work
  meetings to `social`.
- If the event carries no signal, fall back to `system / unknown` with
  low confidence.

Your rationale must be one short sentence naming the signals you used.
Your signals array must list each rule or keyword you matched, in the
order you weighted them.

Household context:
{{household_context}}

## User Prompt Template

Event to classify:

Title: {{title}}
Description: {{description}}
Location: {{location}}
Starts at: {{starts_at}}
Ends at: {{ends_at}}
All day: {{all_day}}
Provider: {{provider}}
Owner email: {{owner_email}}
Attendees:
{{attendees}}

Return JSON only, matching this shape:

```
{
  "segment": "financial | food | fun | social | system",
  "kind": "reservation | meeting | birthday | anniversary | travel | bill | subscription | unknown",
  "confidence": 0.0,
  "rationale": "one short sentence",
  "signals": ["ordered list of signals you used"]
}
```

## Few-shot Examples

### Example 1 — Dinner reservation

Input:

```
Title: Dinner reservation — Giulia's
Location: Giulia's Restaurant, Cambridge MA
```

Output:

```json
{
  "segment": "food",
  "kind": "reservation",
  "confidence": 0.95,
  "rationale": "Dinner reservation at a named restaurant; OpenTable signals absent but strong.",
  "signals": ["title.keyword:reservation", "location.named-restaurant"]
}
```

### Example 2 — Subscription renewal

Input:

```
Title: Netflix subscription renewal
All day: true
```

Output:

```json
{
  "segment": "financial",
  "kind": "subscription",
  "confidence": 0.95,
  "rationale": "Title names a subscription renewal.",
  "signals": ["title.keyword:subscription", "title.keyword:renewal"]
}
```

### Example 3 — Focus time

Input:

```
Title: Focus time
Description: Deep work.
```

Output:

```json
{
  "segment": "system",
  "kind": "unknown",
  "confidence": 0.9,
  "rationale": "Work focus block; nothing household-relevant.",
  "signals": ["title.keyword:focus"]
}
```
