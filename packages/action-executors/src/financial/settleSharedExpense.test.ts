import { type EmailProvider } from '@homehub/providers-email';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createSettleSharedExpenseExecutor } from './settleSharedExpense.js';

interface MockEmail extends EmailProvider {
  createDraft: Mock;
}

function makeEmail(): MockEmail {
  return {
    listRecentMessages: vi.fn(),
    fetchMessage: vi.fn(),
    fetchFullBody: vi.fn(),
    fetchAttachment: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
    addLabel: vi.fn(),
    ensureLabel: vi.fn(),
    createDraft: vi.fn(async () => ({ draftId: 'd1', threadId: 't1', messageId: 'm1' })),
  } as unknown as MockEmail;
}

describe('createSettleSharedExpenseExecutor', () => {
  it('drafts a message and writes audit + episode', async () => {
    const { supabase, db } = makeFakeSupabase({
      sync: {
        provider_connection: [
          {
            id: 'c1',
            household_id: 'h1',
            member_id: 'm1',
            provider: 'gmail',
            nango_connection_id: 'n1',
            status: 'active',
          },
        ],
      },
      app: { member: [{ id: 'm1', role: 'owner' }] },
      audit: { event: [] },
      mem: { episode: [] },
    });
    const email = makeEmail();
    const executor = createSettleSharedExpenseExecutor({ email, supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'settle_shared_expense' }),
      suggestion: makeSuggestion({
        kind: 'settle_shared_expense',
        preview: {
          counterparty_email: 'friend@example.com',
          counterparty_name: 'Alex',
          amount_cents: 5_000,
          reason: 'dinner',
        },
      }),
      supabase,
    });

    expect(email.createDraft).toHaveBeenCalled();
    expect(db.audit!.event).toHaveLength(1);
    expect(db.mem!.episode).toHaveLength(1);
    expect((result.result as { draft_id: string }).draft_id).toBe('d1');
    expect((result.result as { audited: boolean }).audited).toBe(true);
  });
});
