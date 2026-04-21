import { describe, expect, it } from 'vitest';

import { handler, runConversationTurn } from './handler.js';

describe('foreground-agent handler', () => {
  it('exports runConversationTurn as a function', () => {
    expect(typeof runConversationTurn).toBe('function');
  });

  it('re-exports runConversationTurn as handler', () => {
    expect(handler).toBe(runConversationTurn);
  });

  it('throws NotYetImplementedError at M0', async () => {
    await expect(
      runConversationTurn({ conversationId: 'conv-1', turnId: 'turn-1' }),
    ).rejects.toThrow(/not implemented/i);
  });
});
