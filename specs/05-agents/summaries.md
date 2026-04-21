# Summaries

**Purpose.** How HomeHub generates the periodic digests that live in the Summaries/Alerts slice of each segment.

**Scope.** Cadence, inputs, outputs, and prompts at a high level.

## Cadence

| Period   | Generated at (household tz)     | Segments                |
|----------|----------------------------------|-------------------------|
| Daily    | 6:30 AM                          | All four (combined briefing) + per-segment where applicable |
| Weekly   | Monday 7:00 AM                   | All four                |
| Monthly  | 1st of month, 8:00 AM            | Financial, Food, Social |

Generation is scheduled in `pg_cron` (DB-only) or Railway cron (if it needs Nango).

## Inputs

Each summary run:

1. Queries the relevant `app.*` rows for the covered window.
2. Pulls the top-k memory nodes relevant to the window via `query_memory`.
3. Fetches the previous same-period summary for continuity ("vs. last week" comparisons).
4. Feeds all of the above, plus household settings (tone preference, units, currency), into the prompt.

## Outputs

Each summary writes:

- `app.summary` row with `body_md`, `model`, `covered_start`, `covered_end`.
- Side-effect edges in `mem.edge` when the summary itself surfaces a new relationship (e.g., introduces a new `topic` node).
- Optional `app.alert` if the summary detected a notable anomaly (large spend, unusual social gap).

## Per-segment templates

### Financial (weekly)
Sections: Cash-flow, top categories, subscriptions renewing this week, budgets status, anomalies.

### Food (weekly)
Sections: meals cooked vs. planned, dominant cuisines, groceries spend vs. budget, waste (expired pantry items), next-week preview.

### Fun (weekly)
Sections: what you did, what's coming, what fell through, suggested activities.

### Social (weekly + monthly)
Sections: people seen, people *not* seen in the window threshold, upcoming social obligations, reciprocity watch (you hosted vs. were hosted).

### Combined daily briefing
A single paragraph: "Here's today." Calendar events, bill due, planned meal, active suggestions. Short — 200 words max.

## Prompt structure

System prompt establishes:

- Household context (members, household name, tz, preferences).
- Tone: neutral, household-assistant-style. No hype.
- Format: markdown with H3 section headers, no front matter.

User prompt provides the structured data, then asks for the summary.

## Latency

Summaries are async; not on a user-facing request path. Generation windows are generous (10+ seconds OK). This allows richer prompts and cheaper background model usage.

## Dependencies

- [`workers.md`](./workers.md)
- [`model-routing.md`](./model-routing.md)
- [`../04-memory-network/retrieval.md`](../04-memory-network/retrieval.md)

## Open questions

- Do we let members customize summary sections? Post-v1 config surface; for v1, defaults are fine.
- Email/push delivery of summaries beyond the in-app view: post-v1; the UI is the primary surface.
