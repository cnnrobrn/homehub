# @homehub/worker-foreground-agent

Runs the per-turn conversation agent loop — ingest the member message, assemble context, call the foreground model with the tool catalog, orchestrate tool calls (serial, with approval gating), stream the response, and write post-turn memory artifacts. See `specs/13-conversation/agent-loop.md`.

- **Owner:** `@frontend-chat`
- **Milestone:** M3.5

## Deployment target (deferred)

The agent loop can live as a Vercel Edge Function (low-latency interactive turns; tight 25s limit) or a Railway worker (long turns with heavy tool use). The decision is deferred to M3.5 per the agent-loop spec's open questions.

M0 scaffold: we build a worker package so CI has something to typecheck and the runtime wiring is exercised. The handler file (`src/handler.ts`) exports `runConversationTurn(...)` which either host can import.

## Current status

**M0 stub.** `/health` and `/ready` are live; `runConversationTurn` throws `NotYetImplementedError`. `@frontend-chat` picks this up in M3.5.
