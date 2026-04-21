import { describe, expect, it } from 'vitest';

import { PermanentExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createGiftIdeaExecutor } from './giftIdea.js';

describe('createGiftIdeaExecutor', () => {
  it('creates a new topic node with gift_ideas metadata', async () => {
    const { supabase, db } = makeFakeSupabase({ mem: { node: [] } });
    const executor = createGiftIdeaExecutor({ supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'gift_idea' }),
      suggestion: makeSuggestion({
        kind: 'gift_idea',
        preview: {
          person_node_id: 'a0e24d39-9c26-4c67-aa00-de84b32486e8',
          person_display_name: 'Dad',
          gift_ideas: ['socks', 'mug'],
        },
      }),
      supabase,
    });

    expect(db.mem!.node).toHaveLength(1);
    expect(db.mem!.node![0]!.canonical_name).toBe('Gift idea for Dad');
    expect((result.result as { topic_node_id: string }).topic_node_id).toBeTruthy();
    expect((result.result as { appended: boolean }).appended).toBe(false);
  });

  it('appends to an existing topic node (dedup)', async () => {
    const { supabase, db } = makeFakeSupabase({
      mem: {
        node: [
          {
            id: 'n1',
            household_id: 'h1',
            type: 'topic',
            canonical_name: 'Gift idea for Dad',
            metadata: { gift_ideas: ['socks'] },
          },
        ],
      },
    });
    const executor = createGiftIdeaExecutor({ supabase });

    const result = await runExecutor(executor, {
      action: makeAction(),
      suggestion: makeSuggestion({
        preview: {
          person_node_id: 'a0e24d39-9c26-4c67-aa00-de84b32486e8',
          person_display_name: 'Dad',
          gift_ideas: ['mug', 'socks'], // "socks" is already there.
        },
      }),
      supabase,
    });

    const meta = db.mem!.node![0]!.metadata as { gift_ideas: string[] };
    expect(meta.gift_ideas).toEqual(['socks', 'mug']);
    expect((result.result as { appended: boolean }).appended).toBe(true);
  });

  it('validates payload — empty gift_ideas rejects', async () => {
    const { supabase } = makeFakeSupabase({ mem: { node: [] } });
    const executor = createGiftIdeaExecutor({ supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: {
            person_node_id: 'a0e24d39-9c26-4c67-aa00-de84b32486e8',
            person_display_name: 'Dad',
            gift_ideas: [],
          },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });
});
