# `extraction/event` — M3 draft

**Status.** Draft. **No runtime code imports this file yet.** The
deterministic classifier in `@homehub/enrichment` is the live M2-B path.
This document freezes the M3 intent so the swap in M3 is mechanical
rather than design-on-the-fly.

**Spec anchor.** `specs/04-memory-network/extraction.md` — atomicity
rule, extraction contract, two-stage write, structured-output
discipline. `specs/05-agents/model-routing.md` — background tier, Kimi
K2 default, JSON mode on.

---

## Target output schema

Strict JSON, validated by Zod on the worker side. Schema violations
route the message to the DLQ — the worker never tries to "parse
best-effort". Shape matches the `episodes` + `facts` contract in
`extraction.md`.

```json
{
  "classification": {
    "segment": "financial | food | fun | social | system",
    "kind": "reservation | meeting | birthday | anniversary | travel | bill | subscription | unknown",
    "confidence": 0.0,
    "rationale": "short sentence"
  },
  "episodes": [
    {
      "occurred_at": "ISO-8601",
      "summary": "natural language summary",
      "participants": ["person:<id-or-display-name>"],
      "mentions_facts": ["f_001"]
    }
  ],
  "facts": [
    {
      "id": "f_001",
      "subject": "person:<id>",
      "predicate": "<snake_case_predicate>",
      "object": "<string | number | date>",
      "qualifier": { "key": "value" },
      "confidence": 0.0,
      "evidence": "short justification",
      "valid_from": "ISO-8601 | 'inferred'"
    }
  ]
}
```

Invariants the worker will enforce post-parse:

- `facts[].id` is unique within the response.
- Every `episodes[].mentions_facts[]` references a valid `facts[].id`.
- `classification.confidence`, `facts[].confidence` ∈ [0, 1].
- `segment` and `kind` are from the enums in
  `packages/enrichment/src/types.ts`.

## System prompt (template)

```
You are the HomeHub enrichment model.

You classify calendar events and extract atomic, member-useful facts
from them. Follow the atomicity rule: one subject + predicate + object
per fact. Do not concatenate attributes into prose.

You output JSON only, matching the schema the worker provided. If a
fact is uncertain, lower its confidence — do not drop it. If nothing
can be extracted, return empty arrays.

Household context:
{{household_context}}

Household members and known people:
{{household_people}}

Guidelines:
- Default segment assignments:
  - financial: bills, subscriptions, rent, mortgage, taxes.
  - food: meals, reservations, groceries, meal prep.
  - fun: concerts, trips, movies, games, vacations.
  - social: birthdays, anniversaries, weddings, playdates, reach-outs.
  - system: work meetings, focus time, anything not classifiable.
- Order matters: "birthday party" is social, not fun; "OpenTable
  reservation" is food, not social, regardless of attendees.
- Member-written notes override inferences. If the member tagged the
  event, trust the tag.
- Destructive predicates (allergen, birth date, home address) require
  explicit evidence — never infer.
```

## User prompt (template)

```
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

Existing enrichment (if any):
{{existing_enrichment}}

Return JSON only.
```

## Few-shot examples

Each example pairs a compact event input with the target JSON output.
Examples live in the prompt payload to anchor the model's behavior on
common household shapes.

### Financial

**Example F1 — recurring bill**

Input:

```
Title: Electric bill due
Description: Auto-pay runs tonight.
Starts at: 2026-05-01T09:00:00Z
All day: false
Attendees: (none)
Owner email: owner@example.com
```

Output:

```json
{
  "classification": {
    "segment": "financial",
    "kind": "bill",
    "confidence": 0.95,
    "rationale": "Title explicitly announces a utility bill due; description confirms auto-pay."
  },
  "episodes": [
    {
      "occurred_at": "2026-05-01T09:00:00Z",
      "summary": "Electric bill due; auto-pay scheduled for that evening.",
      "participants": [],
      "mentions_facts": ["f_001"]
    }
  ],
  "facts": [
    {
      "id": "f_001",
      "subject": "household",
      "predicate": "has_recurring_bill",
      "object": "electric",
      "qualifier": { "payment_method": "auto_pay" },
      "confidence": 0.8,
      "evidence": "Title names an electric bill; auto-pay in description.",
      "valid_from": "inferred"
    }
  ]
}
```

**Example F2 — subscription renewal**

Input:

```
Title: Netflix subscription renewal
Starts at: 2026-05-15
All day: true
```

Output:

```json
{
  "classification": {
    "segment": "financial",
    "kind": "subscription",
    "confidence": 0.95,
    "rationale": "Title names a subscription and renewal date."
  },
  "episodes": [
    {
      "occurred_at": "2026-05-15T00:00:00Z",
      "summary": "Netflix subscription renews.",
      "participants": [],
      "mentions_facts": ["f_001"]
    }
  ],
  "facts": [
    {
      "id": "f_001",
      "subject": "household",
      "predicate": "has_subscription",
      "object": "Netflix",
      "qualifier": { "renewal_cadence": "monthly" },
      "confidence": 0.7,
      "evidence": "Event title names Netflix subscription renewal.",
      "valid_from": "inferred"
    }
  ]
}
```

**Example F3 — tax deadline**

Input:

```
Title: Taxes due
Description: File federal + state returns.
All day: true
```

Output:

```json
{
  "classification": {
    "segment": "financial",
    "kind": "bill",
    "confidence": 0.9,
    "rationale": "Annual tax filing deadline."
  },
  "episodes": [
    {
      "occurred_at": "2026-04-15T00:00:00Z",
      "summary": "Federal and state tax filing deadline.",
      "participants": [],
      "mentions_facts": []
    }
  ],
  "facts": []
}
```

### Food

**Example FD1 — OpenTable reservation**

Input:

```
Title: Dinner reservation — Giulia's
Description: Booked via OpenTable. Party of 4.
Location: Giulia's Restaurant, Cambridge MA
Attendees: owner@example.com, partner@example.com
```

Output:

```json
{
  "classification": {
    "segment": "food",
    "kind": "reservation",
    "confidence": 0.95,
    "rationale": "Dinner reservation booked via OpenTable at a named restaurant."
  },
  "episodes": [
    {
      "occurred_at": "2026-04-25T23:00:00Z",
      "summary": "Dinner reservation at Giulia's for 4.",
      "participants": ["person:owner", "person:partner"],
      "mentions_facts": ["f_001"]
    }
  ],
  "facts": [
    {
      "id": "f_001",
      "subject": "place:Giulia's",
      "predicate": "located_in",
      "object": "Cambridge MA",
      "confidence": 0.9,
      "evidence": "Location string on event.",
      "valid_from": "inferred"
    }
  ]
}
```

**Example FD2 — weekly grocery run**

Input:

```
Title: Grocery run
Starts at: 2026-04-27T19:00:00Z
```

Output:

```json
{
  "classification": {
    "segment": "food",
    "kind": "unknown",
    "confidence": 0.9,
    "rationale": "Grocery errand."
  },
  "episodes": [],
  "facts": []
}
```

**Example FD3 — meal prep**

Input:

```
Title: Meal prep
Starts at: 2026-05-03T14:00:00Z
```

Output:

```json
{
  "classification": {
    "segment": "food",
    "kind": "unknown",
    "confidence": 0.85,
    "rationale": "Weekend meal-prep block."
  },
  "episodes": [],
  "facts": []
}
```

### Fun

**Example FN1 — concert with tickets**

Input:

```
Title: Concert — Vampire Weekend
Description: Tickets in inbox. Doors 7pm.
Location: The Wang Theater
```

Output:

```json
{
  "classification": {
    "segment": "fun",
    "kind": "unknown",
    "confidence": 0.95,
    "rationale": "Named concert at a known venue with tickets already purchased."
  },
  "episodes": [
    {
      "occurred_at": "2026-05-10T23:30:00Z",
      "summary": "Vampire Weekend concert at the Wang Theater.",
      "participants": [],
      "mentions_facts": ["f_001"]
    }
  ],
  "facts": [
    {
      "id": "f_001",
      "subject": "household",
      "predicate": "attended_concert",
      "object": "Vampire Weekend",
      "qualifier": { "venue": "Wang Theater" },
      "confidence": 0.7,
      "evidence": "Event title + location.",
      "valid_from": "inferred"
    }
  ]
}
```

**Example FN2 — flight**

Input:

```
Title: Flight BOS → DEN
Description: United 1234.
```

Output:

```json
{
  "classification": {
    "segment": "fun",
    "kind": "travel",
    "confidence": 0.95,
    "rationale": "Commercial flight."
  },
  "episodes": [
    {
      "occurred_at": "2026-06-12T15:00:00Z",
      "summary": "Outbound flight from Boston to Denver on United 1234.",
      "participants": [],
      "mentions_facts": []
    }
  ],
  "facts": []
}
```

**Example FN3 — vacation block**

Input:

```
Title: Vacation — Maine
All day: true
```

Output:

```json
{
  "classification": {
    "segment": "fun",
    "kind": "travel",
    "confidence": 0.9,
    "rationale": "Multi-day vacation block; destination in title."
  },
  "episodes": [
    {
      "occurred_at": "2026-07-20T00:00:00Z",
      "summary": "Vacation in Maine.",
      "participants": [],
      "mentions_facts": ["f_001"]
    }
  ],
  "facts": [
    {
      "id": "f_001",
      "subject": "household",
      "predicate": "vacationed_in",
      "object": "Maine",
      "confidence": 0.6,
      "evidence": "Event title names destination.",
      "valid_from": "inferred"
    }
  ]
}
```

### Social

**Example S1 — birthday party**

Input:

```
Title: Lila's 5th birthday party
Location: Our place
Attendees: owner@example.com, partner@example.com, friend@external.example.com
```

Output:

```json
{
  "classification": {
    "segment": "social",
    "kind": "birthday",
    "confidence": 0.95,
    "rationale": "Named birthday party hosted at home."
  },
  "episodes": [
    {
      "occurred_at": "2026-05-16T20:00:00Z",
      "summary": "Lila's 5th birthday party at home.",
      "participants": ["person:Lila", "person:friend"],
      "mentions_facts": ["f_001"]
    }
  ],
  "facts": [
    {
      "id": "f_001",
      "subject": "person:Lila",
      "predicate": "has_birthday",
      "object": "2021-05-16",
      "confidence": 0.8,
      "evidence": "Title says 5th birthday on 2026-05-16; back-calc to 2021.",
      "valid_from": "inferred"
    }
  ]
}
```

**Example S2 — coffee with friend**

Input:

```
Title: Coffee with Jordan
Attendees: owner@example.com, jordan@external.example.com
```

Output:

```json
{
  "classification": {
    "segment": "social",
    "kind": "unknown",
    "confidence": 0.85,
    "rationale": "One-on-one coffee touch-point with a named external contact."
  },
  "episodes": [
    {
      "occurred_at": "2026-04-24T14:00:00Z",
      "summary": "Coffee with Jordan.",
      "participants": ["person:Jordan"],
      "mentions_facts": []
    }
  ],
  "facts": []
}
```

**Example S3 — playdate**

Input:

```
Title: Playdate at the park
```

Output:

```json
{
  "classification": {
    "segment": "social",
    "kind": "unknown",
    "confidence": 0.85,
    "rationale": "Child social event."
  },
  "episodes": [
    {
      "occurred_at": "2026-05-02T15:00:00Z",
      "summary": "Playdate at the park.",
      "participants": [],
      "mentions_facts": []
    }
  ],
  "facts": []
}
```

### System

**Example SY1 — work focus block**

Input:

```
Title: Focus time
Description: Deep work. Do not interrupt.
```

Output:

```json
{
  "classification": {
    "segment": "system",
    "kind": "unknown",
    "confidence": 0.9,
    "rationale": "Work focus block; nothing household-relevant."
  },
  "episodes": [],
  "facts": []
}
```

**Example SY2 — standup**

Input:

```
Title: Standup
```

Output:

```json
{
  "classification": {
    "segment": "system",
    "kind": "meeting",
    "confidence": 0.9,
    "rationale": "Team stand-up; not a household event."
  },
  "episodes": [],
  "facts": []
}
```

**Example SY3 — empty title**

Input:

```
Title: (no title)
```

Output:

```json
{
  "classification": {
    "segment": "system",
    "kind": "unknown",
    "confidence": 0.2,
    "rationale": "No classifiable signal."
  },
  "episodes": [],
  "facts": []
}
```

---

## Open decisions for M3

- **Person resolution.** Attendee emails need to resolve to
  `app.person` ids before facts can use `person:<id>`. This worker
  will do best-effort resolution in M3; un-resolved attendees become
  `person:<email>` placeholders that the reconciler upgrades later.
- **Prompt versioning.** When this template changes materially, the
  `prompt_version` bump triggers a backfill of events whose current
  `metadata.enrichment.version` doesn't match — see
  `specs/04-memory-network/enrichment-pipeline.md`.
- **Model budget.** Every call logs to `model_calls`; when the
  household's `model_budget_monthly_cents` is exhausted the worker
  drops back to the deterministic classifier (the one shipping in
  M2-B) so inbound events still land segmented, just without fact
  extraction.
