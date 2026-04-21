import { type GroceryProvider } from '@homehub/providers-grocery';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { PermanentExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createProposeGroceryOrderExecutor } from './proposeGroceryOrder.js';

interface MockGrocery extends GroceryProvider {
  createDraftOrder: Mock;
}

function makeGrocery(overrides: { createDraftOrder?: () => Promise<unknown> } = {}): MockGrocery {
  return {
    listRecentOrders: vi.fn(async () => []),
    getOrder: vi.fn(),
    createDraftOrder:
      (overrides.createDraftOrder as unknown as Mock) ??
      vi.fn(async () => ({ draftId: 'stub-123', url: 'homehub://grocery-draft/stub' })),
  } as unknown as MockGrocery;
}

describe('createProposeGroceryOrderExecutor', () => {
  it('calls createDraftOrder on happy path', async () => {
    const { supabase } = makeFakeSupabase({ sync: { provider_connection: [] } });
    const grocery = makeGrocery();
    const executor = createProposeGroceryOrderExecutor({ grocery, supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'propose_grocery_order' }),
      suggestion: makeSuggestion({
        kind: 'propose_grocery_order',
        preview: {
          items: [{ name: 'Milk', quantity: 1 }],
        },
      }),
      supabase,
    });

    expect(grocery.createDraftOrder).toHaveBeenCalled();
    expect((result.result as { draft_id: string }).draft_id).toBe('stub-123');
  });

  it('empty items list rejects as permanent', async () => {
    const { supabase } = makeFakeSupabase({ sync: { provider_connection: [] } });
    const grocery = makeGrocery();
    const executor = createProposeGroceryOrderExecutor({ grocery, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({ preview: { items: [] } }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });

  it('propagates provider throw as transient by default', async () => {
    const { supabase } = makeFakeSupabase({ sync: { provider_connection: [] } });
    const grocery = makeGrocery({
      createDraftOrder: vi.fn(async () => {
        throw new Error('provider down');
      }),
    });
    const executor = createProposeGroceryOrderExecutor({ grocery, supabase });

    // "provider down" is a plain error → transient path.
    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { items: [{ name: 'Milk', quantity: 1 }] },
        }),
        supabase,
      }),
    ).rejects.toThrow();
  });
});
