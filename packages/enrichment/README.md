# @homehub/enrichment

Classifier + extraction helpers consumed by the enrichment worker.

- **Owner:** @memory-background
- **Status:** M2-B — deterministic `EventClassifier` only. M3 adds a
  model-backed classifier + atomic-fact extraction helpers behind the
  same `EventClassifier` interface.

## Public surface

```ts
import {
  createDeterministicEventClassifier,
  type EventClassification,
  type EventClassifier,
  type EventInput,
} from '@homehub/enrichment';

const classifier = createDeterministicEventClassifier();
const result = classifier.classify(event);
// { segment, kind, confidence, rationale, signals }
```

## Fixtures

Every rule-set change is covered by a JSON fixture under
`fixtures/events/*.json`. Each file pairs one `input` with one
`expected` classification; `classifier.test.ts` loads them all and
asserts exact match. Adding a fixture always means adding its
`expected` block explicitly — never snapshot-what-the-code-emits
without eyeballing it first.

Current coverage:

- financial: bills, rent, mortgage, taxes, subscription renewal,
  bank-branch location.
- food: OpenTable reservation, lunch/brunch/grocery/meal-prep,
  cafe-location only, weak pizza signal.
- fun: concerts, movies, flights, hotels, vacations, festivals,
  museum visits.
- social: birthdays, anniversaries, weddings, playdates, coffee/catch-
  up, attendee-driven fallback with and without meeting markers.
- system: focus blocks, standups with no attendees, empty titles.

## Specs

- `specs/04-memory-network/extraction.md` — atomicity rule, extraction
  contract, structured-output discipline.
- `specs/05-agents/model-routing.md` — background tier, Kimi K2
  default (M3).
