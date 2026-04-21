import { describe, expect, it, vi } from 'vitest';

import { PermanentExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createSupersedeFactExecutor } from './supersedeFact.js';

// We mock reconcileCandidate so the memory test stays focused on the
// executor's job: write the candidate + invoke the reconciler +
// forward its outcome.
vi.mock('@homehub/enrichment', () => ({
  reconcileCandidate: vi.fn(async (_deps: unknown, candidateId: string) => ({
    outcome: 'promoted' as const,
    candidateId,
    factId: 'fact-1',
    reason: 'promoted',
    touchedNodeIds: [],
  })),
}));

describe('createSupersedeFactExecutor', () => {
  it('writes a member-sourced fact_candidate and calls reconciler', async () => {
    const { supabase, db } = makeFakeSupabase({ mem: { fact_candidate: [] } });
    const executor = createSupersedeFactExecutor({
      supabase,
      now: () => new Date('2026-04-20T00:00:00Z'),
    });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'supersede_fact' }),
      suggestion: makeSuggestion({
        kind: 'supersede_fact',
        preview: {
          subject_node_id: '3a56783d-61aa-44ce-9bdb-fab00c18997f',
          predicate: 'lives_at',
          new_object_value: '123 New St',
        },
      }),
      supabase,
    });

    expect(db.mem!.fact_candidate).toHaveLength(1);
    expect(db.mem!.fact_candidate![0]!.source).toBe('member');
    expect(db.mem!.fact_candidate![0]!.object_value).toBe('123 New St');
    expect((result.result as { outcome: string }).outcome).toBe('promoted');
  });

  it('validates payload — missing subject rejects', async () => {
    const { supabase } = makeFakeSupabase({ mem: { fact_candidate: [] } });
    const executor = createSupersedeFactExecutor({ supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { predicate: 'lives_at', new_object_value: 'x' },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });
});
