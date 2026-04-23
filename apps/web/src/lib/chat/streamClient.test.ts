/**
 * SSE parser tests.
 *
 * Runs under node (no DOM) — validates that the frame parser
 * correctly handles multi-event payloads and malformed frames.
 */

import { describe, expect, it, vi } from 'vitest';

import { postChatStream, type StreamEvent } from './streamClient';

function makeBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(iter: AsyncGenerator<StreamEvent, void, void>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe('postChatStream', () => {
  it('parses multi-event SSE body', async () => {
    const body = makeBody([
      'data: {"type":"start","turnId":"t1","conversationId":"c1"}\n\n',
      'data: {"type":"thinking","delta":"checking memory"}\n\n',
      'data: {"type":"token","delta":"hello"}\n\n',
      'data: {"type":"final","turnId":"t1","conversationId":"c1","assistantBody":"hello","toolCalls":[],"citations":[],"model":"claude","inputTokens":1,"outputTokens":1,"costUsd":0}\n\n',
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      body,
      status: 200,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(postChatStream({ conversationId: 'c1', message: 'hi' }));
    expect(events.map((e) => e.type)).toEqual(['start', 'thinking', 'token', 'final']);
  });

  it('emits an error event on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      body: null,
      status: 500,
      text: async () => 'boom',
    } as unknown as Response);

    const events = await collect(postChatStream({ conversationId: 'c1', message: 'hi' }));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
  });

  it('tolerates malformed data frames without aborting the stream', async () => {
    const body = makeBody([
      'data: not-json\n\n',
      'data: {"type":"final","turnId":"t1","conversationId":"c1","assistantBody":"ok","toolCalls":[],"citations":[],"model":"m","inputTokens":0,"outputTokens":0,"costUsd":0}\n\n',
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      body,
      status: 200,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(postChatStream({ conversationId: 'c1', message: 'hi' }));
    expect(events.map((e) => e.type)).toContain('error');
    expect(events.map((e) => e.type)).toContain('final');
  });
});
