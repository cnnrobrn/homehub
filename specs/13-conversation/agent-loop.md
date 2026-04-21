# Agent Loop

**Purpose.** What happens between "member hits send" and "response finishes streaming."

**Scope.** The per-turn loop, context assembly, tool orchestration, and post-turn memory writes.

## The loop at a glance

```
1. ingest turn          — persist member message, fire metadata extraction
2. assemble context     — system prompt + household context + retrieval
3. call foreground model — streaming, with tool catalog
4. handle tool calls    — serial, with approval gating where required
5. stream response      — model tokens interleaved with tool-card events
6. post-turn write      — conversation-to-episode, fact candidates, model-call log
```

Each stage is a discrete, observable step. The loop lives in `apps/workers/foreground-agent` (or in a Vercel Edge Function for low-latency turns; likely split — see Open questions).

## Stage 1 — Ingest turn

- Persist the member's message as an `app.conversation_turn` row.
- Fire an async extraction on the member turn (low-priority queue) — member messages often contain teachable facts ("Sarah is vegetarian now").
- Do not block the response on that extraction.

## Stage 2 — Assemble context

Context assembly is **not** "stuff everything into the prompt." It's a deliberate, slotted construction. Slots:

| Slot                    | Contents                                                             |
|-------------------------|----------------------------------------------------------------------|
| System                  | Persona + household framing + principles + tool rules. Cached.       |
| Household facts (stable)| Member roster, tz, currency, top rules. Cached; invalidated on edit. |
| Procedural layer        | Active patterns + rules relevant to the likely intent.                |
| Conversation history    | Last N turns of this conversation.                                    |
| Retrieved memory        | `query_memory` over the current message with layer-aware filters.     |
| Active entities         | Any entities the member @-mentioned.                                  |
| Pending items           | Active alerts and pending suggestions that might be relevant.         |

Prompt caching is applied to the stable prefix (System + Household facts + Procedural) so the cache-hit rate is high across turns.

The **intent prefilter** — a fast cheap model classifies the message into coarse intents (ask, plan, draft, act, edit-memory, other). The intent tunes which slots get filled and how aggressively retrieval runs. This is a meaningful cost-reduction and latency win.

## Stage 3 — Call foreground model

- Model: foreground tier (see [`../05-agents/model-routing.md`](../05-agents/model-routing.md)).
- Tools: the full catalog from [`tools.md`](./tools.md), scoped to the member's segment grants.
- Streaming enabled.
- `max_tool_iterations = 5` by default. Beyond 5, the loop yields to the user with a "still working — keep going?" card.

## Stage 4 — Handle tool calls

Tool calls are executed **serially** in v1. Parallel tool use is tempting but a foot-gun for a household assistant where tool calls have side effects.

For each tool call:

1. Validate caller rights (member's grants cover this tool's segment).
2. Validate structural arguments (Zod schemas in `packages/tools`).
3. Classify: **read**, **draft-write** (creates a suggestion), or **direct-write** (updates memory or household state directly).
4. Execute according to class:
   - **read** — run and return result.
   - **draft-write** — create the suggestion / draft; do not execute the underlying action. The UI renders the suggestion card inline for approval.
   - **direct-write** — run only for write-classes explicitly allowed without approval (e.g., `remember_fact`, `add_meal_to_plan`, `add_pantry_item`).
5. Append the tool's output as a tool-result message for the model.

Any financial action, third-party write, or destructive memory change is *always* a draft-write that creates a suggestion. Per [`../05-agents/approval-flow.md`](../05-agents/approval-flow.md), those require explicit member approval.

## Stage 5 — Stream response

- Tokens stream to the client.
- Tool calls are announced as they start (UI shows spinner card) and completed (card populates).
- If the model emits a citation for a memory node, the UI resolves it to a chip on the fly.

## Stage 6 — Post-turn writes

After the model finishes:

- Persist the assistant turn with full trace: tool calls, tool outputs, citations, model, tokens, cost.
- **Conversation → episode**: if the turn was substantive (heuristic: length, tool use, entity mentions), enqueue a job to create a `mem.episode` summarizing the exchange with linked entities.
- **Turn → fact candidates**: if the member's message stated facts ("Sarah is vegetarian"), extraction routes those through the normal candidate → reconciliation flow (see [`../04-memory-network/extraction.md`](../04-memory-network/extraction.md)). Member-sourced facts have high confidence.
- **Turn → rule**: if the member stated a rule ("don't suggest restaurants on Tuesdays"), the `create_rule` tool fires, or — if the model didn't call it — a post-turn classifier flags it for the member with a "save as rule?" prompt.

## What is explicitly **not** persisted as memory

- Working-memory scratchpad (the assembled context).
- Model's internal reasoning tokens.
- Conversation turns flagged `no_memory_write` by the member (per [`overview.md`](./overview.md) — "whisper mode").

## Failure behavior

- Model error mid-stream → keep tokens received, surface a "reply interrupted; retry?" card.
- Tool error → surface the error to the member *and* to the model; the model can decide to try a different tool or acknowledge the failure in the reply.
- Long tool runs (> 30s) → surface progress card; member can cancel.

## Observability

Each turn logs:

- Intent classification result.
- Retrieval count per layer.
- Tool calls with latencies.
- Input/output tokens + cost.
- Whether post-turn extraction produced candidates.

All shared with the existing model-call logs pipeline.

## Dependencies

- [`tools.md`](./tools.md)
- [`ui.md`](./ui.md)
- [`conversations-data-model.md`](./conversations-data-model.md)
- [`../05-agents/model-routing.md`](../05-agents/model-routing.md)
- [`../04-memory-network/retrieval.md`](../04-memory-network/retrieval.md)
- [`../05-agents/approval-flow.md`](../05-agents/approval-flow.md)

## Open questions

- Edge Function vs. Railway worker: short turns with small tool calls in Edge for latency; long ones (planning, multi-tool) on Railway. Router decides at intent-classification time.
- Parallel tool calls: defer to v1.1 once we have a failure-mode inventory.
- Cross-conversation memory continuity: if the member starts a new conversation about the same topic, does the agent see prior-conversation context? Yes — via episodic memory, not via direct thread continuation. The new conversation retrieves relevant episodes including prior chats.
