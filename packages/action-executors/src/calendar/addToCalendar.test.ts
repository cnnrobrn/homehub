/**
 * Tests for `createAddToCalendarExecutor`. Covers:
 *
 *   - Happy path: owner-member connection resolved, event created,
 *     result shape returned.
 *   - Missing connection → `PermanentExecutorError('no_google_calendar_connection')`.
 *   - Payload validation failure → `PermanentExecutorError('PAYLOAD_INVALID')`.
 *   - Provider rate limit → transient (not PermanentExecutorError).
 *   - Provider 4xx → permanent.
 */

import { type CalendarProvider, RateLimitError } from '@homehub/providers-calendar';
import { NangoError } from '@homehub/worker-runtime';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { PermanentExecutorError, TransientExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createAddToCalendarExecutor } from './addToCalendar.js';

interface MockCalendar extends CalendarProvider {
  createEvent: Mock;
}

function makeCalendar(overrides: { createEvent?: () => Promise<unknown> } = {}): MockCalendar {
  return {
    listEvents: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
    createEvent:
      (overrides.createEvent as unknown as Mock) ??
      vi.fn(async () => ({ eventId: 'evt_1', htmlLink: 'https://cal.google/evt_1' })),
  } as unknown as MockCalendar;
}

function seedSupabase() {
  return makeFakeSupabase({
    sync: {
      provider_connection: [
        {
          id: 'conn-owner',
          household_id: 'h1',
          member_id: 'm-owner',
          provider: 'gcal',
          nango_connection_id: 'nango-owner',
          status: 'active',
        },
        {
          id: 'conn-adult',
          household_id: 'h1',
          member_id: 'm-adult',
          provider: 'gcal',
          nango_connection_id: 'nango-adult',
          status: 'active',
        },
      ],
    },
    app: {
      member: [
        { id: 'm-owner', role: 'owner' },
        { id: 'm-adult', role: 'adult' },
      ],
    },
  });
}

describe('createAddToCalendarExecutor', () => {
  it('resolves owner connection and creates an event (happy path)', async () => {
    const { supabase } = seedSupabase();
    const calendar = makeCalendar();
    const executor = createAddToCalendarExecutor({ calendar, supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'add_to_calendar' }),
      suggestion: makeSuggestion({
        kind: 'add_to_calendar',
        preview: {
          title: 'Dinner',
          starts_at: '2026-04-20T19:00:00Z',
          ends_at: '2026-04-20T21:00:00Z',
          attendees: ['alice@example.com'],
        },
      }),
      supabase,
    });

    expect(calendar.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'nango-owner',
        title: 'Dinner',
        startsAt: '2026-04-20T19:00:00Z',
      }),
    );
    expect((result.result as { event_id: string }).event_id).toBe('evt_1');
  });

  it('falls back to adult when no owner connection exists', async () => {
    const { supabase } = makeFakeSupabase({
      sync: {
        provider_connection: [
          {
            id: 'conn-adult',
            household_id: 'h1',
            member_id: 'm-adult',
            provider: 'gcal',
            nango_connection_id: 'nango-adult',
            status: 'active',
          },
        ],
      },
      app: {
        member: [{ id: 'm-adult', role: 'adult' }],
      },
    });
    const calendar = makeCalendar();
    const executor = createAddToCalendarExecutor({ calendar, supabase });

    await runExecutor(executor, {
      action: makeAction(),
      suggestion: makeSuggestion({
        preview: { title: 'T', starts_at: '2026-04-20T19:00:00Z' },
      }),
      supabase,
    });

    expect(calendar.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'nango-adult' }),
    );
  });

  it('throws PermanentExecutorError when no connection exists', async () => {
    const { supabase } = makeFakeSupabase({
      sync: { provider_connection: [] },
      app: { member: [] },
    });
    const calendar = makeCalendar();
    const executor = createAddToCalendarExecutor({ calendar, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { title: 'T', starts_at: '2026-04-20T19:00:00Z' },
        }),
        supabase,
      }),
    ).rejects.toMatchObject({
      code: 'no_google_calendar_connection',
    });
  });

  it('throws PermanentExecutorError on validation failure', async () => {
    const { supabase } = seedSupabase();
    const calendar = makeCalendar();
    const executor = createAddToCalendarExecutor({ calendar, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({ preview: { title: '' } }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });

  it('maps provider RateLimitError to TransientExecutorError', async () => {
    const { supabase } = seedSupabase();
    const calendar = makeCalendar({
      createEvent: vi.fn(async () => {
        throw new RateLimitError('rate limited', 30);
      }),
    });
    const executor = createAddToCalendarExecutor({ calendar, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { title: 'T', starts_at: '2026-04-20T19:00:00Z' },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(TransientExecutorError);
  });

  it('maps provider 4xx to PermanentExecutorError', async () => {
    const { supabase } = seedSupabase();
    const calendar = makeCalendar({
      createEvent: vi.fn(async () => {
        throw new NangoError(
          'calendar insert failed',
          { providerConfigKey: 'google-calendar', connectionId: 'nango-owner' },
          {
            cause: {
              response: { status: 400, data: { error: { message: 'bad request' } }, headers: {} },
            },
          },
        );
      }),
    });
    const executor = createAddToCalendarExecutor({ calendar, supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({
          preview: { title: 'T', starts_at: '2026-04-20T19:00:00Z' },
        }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });
});
