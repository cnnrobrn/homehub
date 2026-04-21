import { describe, expect, it } from 'vitest';

import { PermanentExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createProposeTransferExecutor } from './proposeTransfer.js';

describe('createProposeTransferExecutor', () => {
  it('writes an audit event + memory episode and returns logged status', async () => {
    const { supabase, db } = makeFakeSupabase({
      audit: { event: [] },
      mem: { episode: [] },
    });
    const executor = createProposeTransferExecutor({ supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'propose_transfer' }),
      suggestion: makeSuggestion({
        kind: 'propose_transfer',
        preview: {
          from_account: 'Chase Checking',
          to_account: 'Emergency Fund',
          amount_cents: 50_000,
          reason: 'monthly transfer',
        },
      }),
      supabase,
    });

    expect(db.audit!.event).toHaveLength(1);
    expect(db.audit!.event![0]!.action).toBe('financial.transfer.logged');
    expect(db.mem!.episode).toHaveLength(1);
    expect((result.result as { status: string }).status).toBe('logged');
    expect((result.result as { audited: boolean }).audited).toBe(true);
  });

  it('validates payload — negative amount rejects', async () => {
    const { supabase } = makeFakeSupabase({ audit: { event: [] }, mem: { episode: [] } });
    const executor = createProposeTransferExecutor({ supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: {
            from_account: 'a',
            to_account: 'b',
            amount_cents: -100,
          },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });
});
