# Model Routing

**Purpose.** How HomeHub chooses which model to use for which job.

**Scope.** Tiers, defaults, fallbacks, and where Kimi K2 lives in the stack.

## Tiers

| Tier           | Purpose                                                        | Default model              | Latency target |
|----------------|----------------------------------------------------------------|----------------------------|----------------|
| **Background** | Enrichment, summarization, alert drafting, suggestion drafting | Kimi K2 (via OpenRouter)   | async, ~seconds–minutes |
| **Foreground** | Interactive agent turns (household asks a question)            | Stronger/faster model (picked at runtime — Sonnet-class or similar via OpenRouter) | ~sub-2s TTFT |
| **Embeddings** | Vector embeddings for memory nodes                             | Dedicated embedding model via OpenRouter | async |

The vast majority of calls are background. Kimi K2 is a deliberate choice: strong enough for classification, summarization, and structured extraction at a cost point that makes enrichment of every inbound item feasible.

## Why OpenRouter

- Single API, single key, model swap via config.
- Isolates us from individual vendor outages.
- Gives us a cost/latency dashboard per model out of the box.

If OpenRouter itself becomes a single point of failure, we can add a provider-direct fallback (Moonshot API, Anthropic API) via a tiny adapter layer — the call sites already go through a shared `generate()` function for exactly this reason.

## Default parameters

| Tier        | Temperature | Top-p | Max output | JSON mode |
|-------------|-------------|-------|------------|-----------|
| Background enrichment | 0.2 | 0.9 | 2000 | yes |
| Background summarization | 0.5 | 0.9 | 1500 | no |
| Background suggestion | 0.4 | 0.9 | 1000 | yes (tool-call style) |
| Foreground chat | 0.5 | 0.9 | 4000 | no |

Tuned per-task in `packages/prompts/<task>/config.json`.

## Prompt caching

Background prompts have a stable **system** preamble (household context, principles). System prompt is cached via OpenRouter's prompt-cache where the underlying provider supports it. Per [user preference inherited from CLAUDE.md], all Claude API work includes prompt caching; we apply the same discipline to non-Claude models that support caching.

## Fallback

- Primary model fails or rate-limits → OpenRouter auto-routing to a configured alternate.
- Alternate fails → job goes to `sync.dead_letter`, retried on a slow schedule.
- We do not silently substitute a materially different model for structured-extraction tasks; enrichment is locked to Kimi K2 (or a declared equivalent) so graph consistency isn't broken by model drift.

## Per-household budgets

Each household has a `model_budget_monthly_cents`. Enrichment workers check the running tally before calling the model; when budget is exceeded, non-essential jobs (e.g., summary regeneration) are deferred and the member is notified. Essential jobs (enrichment of new inbound data) still run but drop to a cheaper model.

## Observability

- Every model call logs `(household_id, task, model, input_tokens, output_tokens, cost, latency_ms)` to a `model_calls` table.
- Household owners see a "model usage" panel in settings.
- Internal dashboard aggregates across households for cost control.

## Dependencies

- [`workers.md`](./workers.md)
- [`../04-memory-network/enrichment-pipeline.md`](../04-memory-network/enrichment-pipeline.md)
- [`../01-architecture/stack.md`](../01-architecture/stack.md)

## Open questions

- Foreground model choice: decided at session start vs. per-turn. Per-session keeps things simple; revisit if multi-step chains need finer control.
- Do we need a local-embedding option (self-hosted) for households that want no model-provider data flow? Post-v1.
