import { type EmailProvider } from '@homehub/providers-email';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { PermanentExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createProposeBookReservationExecutor } from './proposeBookReservation.js';

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

function seedSupabase() {
  return makeFakeSupabase({
    sync: {
      provider_connection: [
        {
          id: 'c1',
          household_id: 'h1',
          member_id: 'm1',
          provider: 'gmail',
          nango_connection_id: 'nango1',
          status: 'active',
        },
      ],
    },
    app: { member: [{ id: 'm1', role: 'owner' }] },
  });
}

describe('createProposeBookReservationExecutor', () => {
  it('drafts a reservation email with rendered body', async () => {
    const { supabase } = seedSupabase();
    const email = makeEmail();
    const executor = createProposeBookReservationExecutor({ email, supabase });

    await runExecutor(executor, {
      action: makeAction({ kind: 'propose_book_reservation' }),
      suggestion: makeSuggestion({
        kind: 'propose_book_reservation',
        preview: {
          recipient_email: 'venue@example.com',
          venue_name: 'Acme Bistro',
          party_size: 4,
          proposed_times: ['2026-04-20 19:00', '2026-04-21 20:00'],
          notes: 'birthday dinner',
        },
      }),
      supabase,
    });

    const call = email.createDraft.mock.calls[0]![0];
    expect(call.to).toEqual(['venue@example.com']);
    expect(call.subject).toContain('Acme Bistro');
    expect(call.bodyMarkdown).toContain('4 guests');
    expect(call.bodyMarkdown).toContain('2026-04-20 19:00');
    expect(call.bodyMarkdown).toContain('birthday dinner');
  });

  it('validation fails on missing proposed_times', async () => {
    const { supabase } = seedSupabase();
    const email = makeEmail();
    const executor = createProposeBookReservationExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: {
            recipient_email: 'v@e.com',
            venue_name: 'Bistro',
            party_size: 2,
            proposed_times: [],
          },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });

  it('no gmail connection DLQs', async () => {
    const { supabase } = makeFakeSupabase({ sync: { provider_connection: [] } });
    const email = makeEmail();
    const executor = createProposeBookReservationExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: {
            recipient_email: 'v@e.com',
            venue_name: 'Bistro',
            party_size: 2,
            proposed_times: ['2026-04-20 19:00'],
          },
        }),
        supabase,
      }),
    ).rejects.toMatchObject({ code: 'no_gmail_connection' });
  });
});
