/**
 * Tests for `createDraftMessageExecutor`. Covers happy path, missing
 * connection, invalid payload, transient 429, permanent 4xx.
 */

import { type EmailProvider, RateLimitError } from '@homehub/providers-email';
import { NangoError } from '@homehub/worker-runtime';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { PermanentExecutorError, TransientExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createDraftMessageExecutor } from './draftMessage.js';

interface MockEmail extends EmailProvider {
  createDraft: Mock;
}

function makeEmail(overrides: { createDraft?: () => Promise<unknown> } = {}): MockEmail {
  return {
    listRecentMessages: vi.fn(),
    fetchMessage: vi.fn(),
    fetchFullBody: vi.fn(),
    fetchAttachment: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
    addLabel: vi.fn(),
    ensureLabel: vi.fn(),
    createDraft:
      (overrides.createDraft as unknown as Mock) ??
      vi.fn(async () => ({ draftId: 'drf_1', threadId: 't_1', messageId: 'm_1' })),
  } as unknown as MockEmail;
}

function seedSupabase() {
  return makeFakeSupabase({
    sync: {
      provider_connection: [
        {
          id: 'conn1',
          household_id: 'h1',
          member_id: 'm1',
          provider: 'gmail',
          nango_connection_id: 'nango-1',
          status: 'active',
        },
      ],
    },
    app: { member: [{ id: 'm1', role: 'owner' }] },
  });
}

describe('createDraftMessageExecutor', () => {
  it('drafts via gmail on happy path', async () => {
    const { supabase } = seedSupabase();
    const email = makeEmail();
    const executor = createDraftMessageExecutor({ email, supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'draft_message' }),
      suggestion: makeSuggestion({
        kind: 'draft_message',
        preview: {
          to: ['alice@example.com'],
          subject: 'Hi',
          body_markdown: 'Hello!',
        },
      }),
      supabase,
    });

    expect(email.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['alice@example.com'],
        subject: 'Hi',
        bodyMarkdown: 'Hello!',
      }),
    );
    expect((result.result as { draft_id: string }).draft_id).toBe('drf_1');
  });

  it('throws PermanentExecutorError when no gmail connection', async () => {
    const { supabase } = makeFakeSupabase({ sync: { provider_connection: [] } });
    const email = makeEmail();
    const executor = createDraftMessageExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: {
            to: ['a@b.com'],
            subject: 's',
            body_markdown: 'b',
          },
        }),
        supabase,
      }),
    ).rejects.toMatchObject({ code: 'no_gmail_connection' });
  });

  it('validates payload — invalid email rejects', async () => {
    const { supabase } = seedSupabase();
    const email = makeEmail();
    const executor = createDraftMessageExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { to: ['not-an-email'], subject: 's', body_markdown: 'b' },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });

  it('maps 429 rate limit to transient', async () => {
    const { supabase } = seedSupabase();
    const email = makeEmail({
      createDraft: vi.fn(async () => {
        throw new RateLimitError('rate', 30);
      }),
    });
    const executor = createDraftMessageExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { to: ['a@b.com'], subject: 's', body_markdown: 'b' },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(TransientExecutorError);
  });

  it('maps 4xx Nango error to permanent', async () => {
    const { supabase } = seedSupabase();
    const email = makeEmail({
      createDraft: vi.fn(async () => {
        throw new NangoError(
          'bad',
          { providerConfigKey: 'google-mail', connectionId: 'nango-1' },
          { cause: { response: { status: 403, headers: {}, data: {} } } },
        );
      }),
    });
    const executor = createDraftMessageExecutor({ email, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { to: ['a@b.com'], subject: 's', body_markdown: 'b' },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });
});
