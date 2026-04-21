# Testing Strategy

**Purpose.** What we test, where, and with what confidence targets.

**Scope.** Unit, integration, E2E, and the non-obvious model-eval layer.

## Layers

### Unit

- Target: every function whose behavior is non-trivial and not a thin DB wrapper.
- Focus: detectors (`packages/alerts`), generators (`packages/suggestions`), normalizers (`packages/providers`), RLS helper functions via pgTAP.
- Runtime: vitest. Fast.

### Integration

- Real local Postgres (`supabase start`).
- Real local Nango (docker-compose), with **mocked upstream providers** behind it (recorded fixtures).
- Tests exercise end-to-end paths: "a new Gmail message lands → worker runs → graph updated → alert emitted."
- Runtime: slower; runs on merge rather than every PR (with a fast subset on PRs).

### E2E (frontend)

- Playwright against a seeded staging environment.
- Smoke suite on every deploy.
- Full suite nightly.

### Model evaluation

The non-obvious layer. We do not trust prompt behavior across model changes without evals.

- Per enrichment prompt: a golden set of inputs with expected structured outputs.
- Per summary prompt: a rubric-based eval run via a stronger judge model, scored for format, completeness, and factuality against the linked rows.
- Prompts are versioned; any version bump must pass existing evals + add evals for the change motive.

### RLS tests

Automated (see [`../02-data-model/row-level-security.md`](../02-data-model/row-level-security.md)). Every table with RLS has at least three tests: in-household read allowed, out-of-household read denied, write denied without grant.

## Test data

- Seeded synthetic households (Martins, Priya, Garcia-Chens, Okonkwos — the personas from [`../00-overview/personas.md`](../00-overview/personas.md)).
- Seed generator produces reproducible data for a given seed; CI uses a fixed seed.

## CI performance targets

- PR feedback loop < 5 minutes for PRs not touching workers/migrations.
- Full merge pipeline < 20 minutes.

## Don't test

- Framework behavior (Next.js routing internals).
- Supabase realtime (covered by their tests; we test that we subscribe, not that they deliver).
- Provider SDKs (covered by provider; we test our adapter).

## What to watch for in reviews

- New RLS-enabled table without policy tests → block.
- New prompt without eval additions → block for background prompts; warn for foreground.
- New detector without fixture tests → block.

## Dependencies

- [`../02-data-model/row-level-security.md`](../02-data-model/row-level-security.md)
- [`../05-agents/model-routing.md`](../05-agents/model-routing.md)
- [`../10-operations/deployment.md`](../10-operations/deployment.md)

## Open questions

- Load testing: needed when we approach meaningful household count; not v1 priority.
- Chaos testing on workers (killing processes mid-job): yes — a simple nightly job that kills a random worker and verifies recovery.
