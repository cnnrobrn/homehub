import { type EmailProvider } from '@homehub/providers-email';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createCancelSubscriptionExecutor } from './cancelSubscription.js';

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

describe('createCancelSubscriptionExecutor', () => {
  it('looks up contact email from mem.node and drafts via gmail', async () => {
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
      app: { member: [{ id: 'm1', role: 'owner' }] },
      mem: {
        node: [
          {
            id: 'ab349a7e-5678-4123-9abc-567812345678',
            household_id: 'h1',
            type: 'subscription',
            canonical_name: 'Acme Streaming',
            metadata: { contact_email: 'cancel@acme.com' },
          },
        ],
      },
    });
    const email = makeEmail();
    const executor = createCancelSubscriptionExecutor({ email, supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'cancel_subscription' }),
      suggestion: makeSuggestion({
        kind: 'cancel_subscription',
        preview: {
          subscription_node_id: 'ab349a7e-5678-4123-9abc-567812345678',
          subscription_name: 'Acme Streaming',
        },
      }),
      supabase,
    });

    expect(email.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['cancel@acme.com'] }),
    );
    expect((result.result as { guidance_md: string }).guidance_md).toContain('drafted');
  });

  it('throws permanent when no contact email found', async () => {
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
      app: { member: [{ id: 'm1', role: 'owner' }] },
      mem: {
        node: [
          {
            id: 'ab349a7e-5678-4123-9abc-567812345678',
            household_id: 'h1',
            type: 'subscription',
            canonical_name: 'Acme',
            metadata: {},
          },
        ],
      },
    });
    const email = makeEmail();
    const executor = createCancelSubscriptionExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: {
            subscription_node_id: 'ab349a7e-5678-4123-9abc-567812345678',
            subscription_name: 'Acme',
          },
        }),
        supabase,
      }),
    ).rejects.toMatchObject({ code: 'no_subscription_contact_email' });
  });
});
