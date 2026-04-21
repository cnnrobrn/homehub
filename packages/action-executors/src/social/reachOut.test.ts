import { type EmailProvider } from '@homehub/providers-email';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { PermanentExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createReachOutExecutor } from './reachOut.js';

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

describe('createReachOutExecutor', () => {
  it('resolves email via mem.fact has_email and drafts via gmail', async () => {
    const { supabase } = makeFakeSupabase({
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
      app: { member: [{ id: 'm1', role: 'owner' }], person: [] },
      mem: {
        fact: [
          {
            id: 'f1',
            household_id: 'h1',
            subject_node_id: '58199f2f-c7cc-4903-b64f-d363f8ed4bc4',
            predicate: 'has_email',
            object_value: 'bob@example.com',
            valid_to: null,
            superseded_at: null,
          },
        ],
      },
    });
    const email = makeEmail();
    const executor = createReachOutExecutor({ email, supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'reach_out' }),
      suggestion: makeSuggestion({
        kind: 'reach_out',
        preview: {
          person_node_id: '58199f2f-c7cc-4903-b64f-d363f8ed4bc4',
          channel: 'email',
          body_markdown: 'Hey!',
        },
      }),
      supabase,
    });

    expect(email.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['bob@example.com'] }),
    );
    expect((result.result as { recipient_email: string }).recipient_email).toBe('bob@example.com');
  });

  it('text channel returns pending sentinel without side effect', async () => {
    const { supabase } = makeFakeSupabase();
    const email = makeEmail();
    const executor = createReachOutExecutor({ email, supabase });

    const result = await runExecutor(executor, {
      action: makeAction(),
      suggestion: makeSuggestion({
        preview: {
          person_node_id: '58199f2f-c7cc-4903-b64f-d363f8ed4bc4',
          channel: 'text',
          body_markdown: 'Hey!',
        },
      }),
      supabase,
    });

    expect(email.createDraft).not.toHaveBeenCalled();
    expect((result.result as { status: string }).status).toBe('text_channel_pending');
  });

  it('permanent error when person has no known email', async () => {
    const { supabase } = makeFakeSupabase({
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
      app: { member: [{ id: 'm1', role: 'owner' }], person: [] },
      mem: { fact: [] },
    });
    const email = makeEmail();
    const executor = createReachOutExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: {
            person_node_id: '58199f2f-c7cc-4903-b64f-d363f8ed4bc4',
            channel: 'email',
            body_markdown: 'Hey!',
          },
        }),
        supabase,
      }),
    ).rejects.toMatchObject({ code: 'no_email_for_person' });
  });

  it('validates channel enum', async () => {
    const { supabase } = makeFakeSupabase();
    const email = makeEmail();
    const executor = createReachOutExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: {
            person_node_id: '58199f2f-c7cc-4903-b64f-d363f8ed4bc4',
            channel: 'fax',
            body_markdown: 'Hey!',
          },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });
});
