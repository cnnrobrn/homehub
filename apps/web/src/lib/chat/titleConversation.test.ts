import { describe, expect, it, vi } from 'vitest';

import {
  CONVERSATION_TITLE_MODEL,
  conversationTitleNeedsGeneration,
  fallbackConversationTitleFromPrompt,
  normalizeGeneratedConversationTitle,
  titleConversationFromFirstPrompt,
} from './titleConversation';

describe('conversation title generation', () => {
  it('treats missing and generic titles as needing generation', () => {
    expect(conversationTitleNeedsGeneration(null)).toBe(true);
    expect(conversationTitleNeedsGeneration('')).toBe(true);
    expect(conversationTitleNeedsGeneration('Untitled')).toBe(true);
    expect(conversationTitleNeedsGeneration('untitiled')).toBe(true);
    expect(conversationTitleNeedsGeneration('Dinner Plan')).toBe(false);
  });

  it('normalizes model titles for display', () => {
    expect(normalizeGeneratedConversationTitle('"Dinner Plan Ideas."')).toBe('Dinner Plan Ideas');
    expect(normalizeGeneratedConversationTitle('Untitled')).toBeNull();
    expect(
      normalizeGeneratedConversationTitle(
        'A very long conversation title about coordinating spring break logistics and budgets',
      ),
    ).toBe('A very long conversation title about coordinating spring');
  });

  it('builds a deterministic fallback title from the first prompt', () => {
    expect(fallbackConversationTitleFromPrompt('what do i owe for the group trip?')).toBe(
      'Owe Group Trip',
    );
    expect(fallbackConversationTitleFromPrompt('/remember Sarah is vegetarian now')).toBe(
      'Sarah Vegetarian Now',
    );
    expect(fallbackConversationTitleFromPrompt('https://example.com')).toBeNull();
  });

  it('uses Gemma on OpenRouter and writes the generated title', async () => {
    const generate = vi.fn(async () => ({
      text: '{"title":"Dinner Plan Ideas"}',
      parsed: { title: 'Dinner Plan Ideas' },
      model: CONVERSATION_TITLE_MODEL,
      inputTokens: 10,
      outputTokens: 4,
      costUsd: 0,
      latencyMs: 5,
    }));
    const query = {
      error: null,
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
    };
    const from = vi.fn(() => query);
    const schema = vi.fn(() => ({ from }));
    const warn = vi.fn();

    const title = await titleConversationFromFirstPrompt({
      supabase: { schema } as never,
      modelClient: { generate, embed: vi.fn() } as never,
      logger: { warn } as never,
      householdId: 'household-1',
      conversationId: 'conversation-1',
      firstPrompt: 'Can you help me plan dinners for next week?',
    });

    expect(title).toBe('Dinner Plan Ideas');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'conversation.title',
        model: CONVERSATION_TITLE_MODEL,
        temperature: 0.2,
        maxOutputTokens: 48,
      }),
    );
    expect(query.update).toHaveBeenCalledWith({ title: 'Dinner Plan Ideas' });
    expect(query.eq).toHaveBeenCalledWith('id', 'conversation-1');
    expect(query.eq).toHaveBeenCalledWith('household_id', 'household-1');
    expect(warn).not.toHaveBeenCalled();
  });
});
