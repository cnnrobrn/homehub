# Event classifier fixtures

Each `*.json` file pairs one `input` (an `EventInput` the classifier
consumes) with one `expected` (the `EventClassification` it should
produce). The snapshot test in `classifier.test.ts` loads every fixture
in this directory and asserts that the classifier returns exactly
`expected` for `input`.

When you add a new fixture, run the tests once and copy the actual
output into `expected` — but only after eyeballing that the
classification is the one the rules _should_ produce. A failing fixture
should never be "fixed" by silently snapshotting whatever the rules
emit today.

File-naming convention: `<segment>-<short-desc>.json`, kebab case. The
prefix keeps fixtures sorted by segment in a directory listing.
