/**
 * @vitest-environment jsdom
 *
 * Chat thread rendering around the submit path. The route persists
 * the member turn before streaming, but the client still needs to
 * show the submitted text immediately while the refresh catches up.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { ChatThread } from './ChatThread';

import type { ConversationTurnDisplayRow } from '@/lib/chat/loadConversations';

const conversationId = '11111111-1111-4111-8111-111111111111';

function makeFinalStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'final',
            turnId: '22222222-2222-4222-8222-222222222222',
            conversationId,
            assistantBody: '',
            toolCalls: [],
            citations: [],
            model: 'test-model',
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });
}

function renderThread(initialTurns: ConversationTurnDisplayRow[] = []) {
  return render(
    <ChatThread
      conversationId={conversationId}
      initialTurns={initialTurns}
      initialNowIso="2026-04-23T12:00:00.000Z"
      timeZone="UTC"
    />,
  );
}

describe('ChatThread', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: makeFinalStream(),
      status: 200,
      text: async () => '',
    } as unknown as Response);
  });

  it('shows a submitted member message immediately and reconciles the persisted turn', async () => {
    const message = "what's for dinner tonight?";
    const { rerender } = renderThread();

    fireEvent.change(screen.getByRole('textbox', { name: /message composer/i }), {
      target: { value: message },
    });
    fireEvent.submit(screen.getByRole('textbox', { name: /message composer/i }).closest('form')!);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/is ready/i)).not.toBeInTheDocument();

    const persistedTurn: ConversationTurnDisplayRow = {
      id: '33333333-3333-4333-8333-333333333333',
      role: 'member',
      body_md: message,
      author_member_id: '44444444-4444-4444-8444-444444444444',
      author_display_name: 'Alex',
      created_at: '2100-01-01T00:00:00.000Z',
      tool_calls: [],
      citations: [],
      model: null,
    };

    rerender(
      <ChatThread
        conversationId={conversationId}
        initialTurns={[persistedTurn]}
        initialNowIso="2026-04-23T12:00:00.000Z"
        timeZone="UTC"
      />,
    );

    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
  });
});
