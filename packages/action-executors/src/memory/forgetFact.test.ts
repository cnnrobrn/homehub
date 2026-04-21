import { describe, expect, it, vi } from 'vitest';

import { PermanentExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createForgetFactExecutor } from './forgetFact.js';

vi.mock('@homehub/enrichment', () => ({
  reconcileCandidate: vi.fn(async (_deps: unknown, candidateId: string) => ({
    outcome: 'deleted' as const,
    candidateId,
    factId: 'fact-old',
    reason: 'deleted_by_member',
    touchedNodeIds: [],
  })),
}));

describe('createForgetFactExecutor', () => {
  it('writes a delete-signature candidate and returns deleted outcome', async () => {
    const { supabase, db } = makeFakeSupabase({ mem: { fact_candidate: [] } });
    const executor = createForgetFactExecutor({
      supabase,
      now: () => new Date('2026-04-20T00:00:00Z'),
    });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'forget_fact' }),
      suggestion: makeSuggestion({
        kind: 'forget_fact',
        preview: {
          subject_node_id: '3a56783d-61aa-44ce-9bdb-fab00c18997f',
          predicate: 'lives_at',
        },
      }),
      supabase,
    });

    expect(db.mem!.fact_candidate).toHaveLength(1);
    const row = db.mem!.fact_candidate![0]!;
    expect(row.source).toBe('member');
    expect(row.object_value).toBeNull();
    expect(row.valid_to).toBe('2026-04-20T00:00:00.000Z');
    expect((result.result as { outcome: string }).outcome).toBe('deleted');
  });

  it('validates payload — missing predicate rejects', async () => {
    const { supabase } = makeFakeSupabase({ mem: { fact_candidate: [] } });
    const executor = createForgetFactExecutor({ supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { subject_node_id: '3a56783d-61aa-44ce-9bdb-fab00c18997f' },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });
});
