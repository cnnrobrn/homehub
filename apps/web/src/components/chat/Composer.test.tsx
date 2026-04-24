/**
 * @vitest-environment jsdom
 *
 * Composer submit path — ensures we post to `/api/chat/stream` and
 * hand the caller a live event iterable.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';

describe('Composer', () => {
  it('disables the submit button when the input is empty', () => {
    render(<Composer conversationId="c1" onStreamStart={() => {}} />);
    const btn = screen.getByRole('button', { name: /send message/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the value to onStreamStart and calls the stream endpoint', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","turnId":"t1","conversationId":"c1","assistantBody":"hi","toolCalls":[],"citations":[],"model":"m","inputTokens":0,"outputTokens":0,"costUsd":0}\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      body,
      status: 200,
      text: async () => '',
    } as unknown as Response);
    const onStart = vi.fn(async (events: AsyncIterable<unknown>, _submittedMessage: string) => {
      // Drain
      for await (const _ of events) void _;
    });
    render(<Composer conversationId="c1" onStreamStart={onStart} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.submit(textarea.closest('form')!);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/chat/stream');
    expect(onStart).toHaveBeenCalled();
    expect(onStart.mock.calls[0]?.[1]).toBe('hello');
  });
});
