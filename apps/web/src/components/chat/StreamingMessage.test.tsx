/**
 * @vitest-environment jsdom
 *
 * Streaming message render behavior for sparse streams.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StreamingMessage } from './StreamingMessage';

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

describe('StreamingMessage', () => {
  it('renders the final assistant body when no token events were streamed', async () => {
    render(<StreamingMessage events={sparseFinalStream()} />);

    expect(await screen.findByText('Dinner is pasta tonight.')).toBeInTheDocument();
    expect(screen.queryByText('(no response)')).not.toBeInTheDocument();
  });
});
