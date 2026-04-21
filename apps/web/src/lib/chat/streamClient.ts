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
          yield parsed;
        } catch {
          yield { type: 'error', message: 'failed to parse SSE frame' };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
