/**
 * @vitest-environment jsdom
 *
 * Streaming message render behavior for sparse streams.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StreamingMessage, type StreamingMessageOutcome } from './StreamingMessage';

import type { StreamEvent } from '@/lib/chat/streamClient';

async function* sparseFinalStream(): AsyncGenerator<StreamEvent, void, void> {
  yield {
    type: 'final',
    turnId: 'turn-1',
    conversationId: 'conversation-1',
    assistantBody: 'Dinner is pasta tonight.',
    toolCalls: [],
    citations: [],
    model: 'test-model',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
}

async function* tokenThenFinalStream(): AsyncGenerator<StreamEvent, void, void> {
  yield { type: 'token', delta: 'pasta ' };
  yield { type: 'token', delta: 'tonight' };
  yield {
    type: 'final',
    turnId: 'turn-1',
    conversationId: 'conversation-1',
    assistantBody: '',
    toolCalls: [],
    citations: [],
    model: 'kimi-k2.6',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
}

async function* errorThenSilenceStream(): AsyncGenerator<StreamEvent, void, void> {
  yield { type: 'token', delta: 'partial...' };
  yield { type: 'error', message: 'upstream timed out' };
}

async function* eofWithoutTerminalStream(): AsyncGenerator<StreamEvent, void, void> {
  yield { type: 'token', delta: 'cut off mid-' };
}

describe('StreamingMessage', () => {
  it('renders the final assistant body when no token events were streamed', async () => {
    render(<StreamingMessage events={sparseFinalStream()} />);

    expect(await screen.findByText('Dinner is pasta tonight.')).toBeInTheDocument();
    expect(screen.queryByText('(no response)')).not.toBeInTheDocument();
  });

  it('forwards streamed body and model on final via onComplete', async () => {
    const onComplete = vi.fn();
    render(<StreamingMessage events={tokenThenFinalStream()} onComplete={onComplete} />);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const outcome = onComplete.mock.calls[0]?.[0] as StreamingMessageOutcome;
    expect(outcome.kind).toBe('final');
    if (outcome.kind === 'final') {
      expect(outcome.assistantBody).toBe('pasta tonight');
      expect(outcome.model).toBe('kimi-k2.6');
    }
  });

  it('reports kind=error and keeps the body visible when the server emits error', async () => {
    const onComplete = vi.fn();
    render(<StreamingMessage events={errorThenSilenceStream()} onComplete={onComplete} />);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect((onComplete.mock.calls[0]?.[0] as StreamingMessageOutcome).kind).toBe('error');
    expect(screen.getByText(/upstream timed out/)).toBeInTheDocument();
  });

  it('reports kind=error when the stream EOFs without any terminal event', async () => {
    const onComplete = vi.fn();
    render(<StreamingMessage events={eofWithoutTerminalStream()} onComplete={onComplete} />);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect((onComplete.mock.calls[0]?.[0] as StreamingMessageOutcome).kind).toBe('error');
  });
});
