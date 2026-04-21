import { type CalendarProvider } from '@homehub/providers-calendar';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createOutingIdeaExecutor } from './outingIdea.js';

interface MockCalendar extends CalendarProvider {
  createEvent: Mock;
}

function makeCalendar(throwsOnCreate = false): MockCalendar {
  return {
    listEvents: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
    createEvent: throwsOnCreate
      ? vi.fn(async () => {
          throw new Error('nope');
        })
      : vi.fn(async () => ({ eventId: 'evt1', htmlLink: 'https://cal/1' })),
  } as unknown as MockCalendar;
}

function seedSupabase() {
  return makeFakeSupabase({
    sync: {
      provider_connection: [
        {
          id: 'c1',
          household_id: 'h1',
          member_id: 'm1',
          provider: 'gcal',
          nango_connection_id: 'n1',
          status: 'active',
        },
      ],
    },
    app: { member: [{ id: 'm1', role: 'owner' }] },
  });
}

describe('createOutingIdeaExecutor', () => {
  it('mirrors to gcal by default', async () => {
    const { supabase } = seedSupabase();
    const calendar = makeCalendar();
    const executor = createOutingIdeaExecutor({ calendar, supabase });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'outing_idea' }),
      suggestion: makeSuggestion({
        kind: 'outing_idea',
        preview: {
          title: 'Beach trip',
          starts_at: '2026-05-01T10:00:00Z',
          ends_at: '2026-05-01T18:00:00Z',
          location: 'Ocean Beach',
        },
      }),
      supabase,
    });

    expect(calendar.createEvent).toHaveBeenCalled();
    expect((result.result as { mirrored: boolean }).mirrored).toBe(true);
  });

  it('skips gcal when mirror_to_gcal=false', async () => {
    const { supabase } = seedSupabase();
    const calendar = makeCalendar();
    const executor = createOutingIdeaExecutor({ calendar, supabase });

    const result = await runExecutor(executor, {
      action: makeAction(),
      suggestion: makeSuggestion({
        preview: {
          title: 'x',
          starts_at: '2026-05-01T10:00:00Z',
          mirror_to_gcal: false,
        },
      }),
      supabase,
    });

    expect(calendar.createEvent).not.toHaveBeenCalled();
    expect((result.result as { status: string }).status).toBe('logged');
  });
});
