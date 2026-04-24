/**
 * Browser-side SSE consumer for `/api/chat/stream`.
 *
 * Keeps the shape of `AgentStreamEvent` (from
 * `@homehub/worker-foreground-agent`) structurally equivalent but
 * declared locally so the client bundle doesn't pull in the worker
 * package. When a new event variant is added, update both the
 * worker and this file; the shapes are tiny.
 */

export type StreamEvent =
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
      classification?: string | null;
    }
  | {
      type: 'tool_call_done';
      callId: string;
      tool: string;
      classification: string;
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

export async function* postChatStream(args: {
  conversationId: string;
  message: string;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent, void, void> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: args.conversationId,
      message: args.message,
    }),
    ...(args.signal ? { signal: args.signal } : {}),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    yield {
      type: 'error',
      message: `stream request failed: ${res.status} ${text.slice(0, 200)}`,
    };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawTerminal = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames separated by \n\n. Each frame's data lines begin with "data: ".
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        const payload = dataLines.join('\n');
        try {
          const parsed = JSON.parse(payload) as StreamEvent;
          if (parsed.type === 'final' || parsed.type === 'error') sawTerminal = true;
          yield parsed;
        } catch {
          yield { type: 'error', message: 'failed to parse SSE frame' };
        }
      }
    }
    if (!sawTerminal) {
      // Server closed the connection without a terminal event — usually
      // an upstream crash or socket reset mid-turn. Surface this so the
      // UI can show a real error instead of silently rendering "(no
      // response)" and triggering a refresh that hides the failure.
      yield {
        type: 'error',
        message: 'Connection closed before the assistant finished. Please try again.',
        code: 'stream_ended_without_final',
      };
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Caller aborted (navigation away, explicit cancel) — silent exit.
      return;
    }
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'stream read failed',
      code: 'stream_read_failed',
    };
  } finally {
    reader.releaseLock();
  }
}
