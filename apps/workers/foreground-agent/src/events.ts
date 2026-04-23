/**
 * Agent-loop stream events.
 *
 * The loop produces an ordered sequence of discrete events. The web
 * route handler translates these into Server-Sent Events; tests assert
 * on the sequence directly.
 *
 * Deliberately narrow: one producer (the loop), two consumers (the
 * route handler + tests). If you need to extend, prefer a new
 * discriminant over widening an existing one — the web client switches
 * on `type`.
 */

import type { ToolClass } from '@homehub/tools';

export type AgentStreamEvent =
  | { type: 'start'; turnId: string; conversationId: string }
  | { type: 'intent'; intent: string; retrieval_depth: string; segments: string[] }
  | { type: 'token'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'thinking_status'; message: string }
  | { type: 'status'; message: string }
  | { type: 'tool_generation'; tool: string }
  | {
      type: 'tool_call_start';
      callId: string;
      tool: string;
      arguments: Record<string, unknown>;
      classification?: ToolClass | null;
    }
  | {
      type: 'tool_call_done';
      callId: string;
      tool: string;
      classification: ToolClass;
      result: unknown;
      latencyMs: number;
    }
  | {
      type: 'tool_call_error';
      callId: string;
      tool: string;
      error: { code: string; message: string };
    }
  | {
      type: 'suggestion_card';
      callId: string;
      tool: string;
      summary: string;
      preview: unknown;
    }
  | { type: 'citation'; chip: string; nodeId: string; label: string }
  | {
      type: 'final';
      turnId: string;
      conversationId: string;
      assistantBody: string;
      toolCalls: unknown[];
      citations: unknown[];
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  | { type: 'error'; message: string; code?: string };
