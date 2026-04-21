/**
 * `foreground-agent` conversation turn runner.
 *
 * Per `specs/13-conversation/agent-loop.md`, each turn walks through
 * ingest → context assembly → model call → tool orchestration → stream
 * → post-turn writes. The host can be either a Vercel Edge Function
 * (low-latency interactive turns) or a Railway worker (long turns with
 * heavy tool use). M0 decision: defer. Scaffolded as a worker so CI has
 * something to typecheck; @frontend-chat picks the final shape in M3.5.
 */

import { NotYetImplementedError } from '@homehub/worker-runtime';

export interface ConversationTurnInput {
  readonly conversationId: string;
  readonly turnId: string;
}

/**
 * Runs a single conversation turn. M0 stub; @frontend-chat replaces in
 * M3.5 alongside the edge-vs-worker decision.
 */
export async function runConversationTurn(_input: ConversationTurnInput): Promise<void> {
  throw new NotYetImplementedError(
    'runConversationTurn not implemented; @frontend-chat ships the agent loop in M3.5',
  );
}

/**
 * Alias kept so the worker-fleet test that asserts `handler` exists
 * doesn't need special-casing. Any future generic worker-harness that
 * calls `handler()` will still compile.
 */
export const handler = runConversationTurn;
