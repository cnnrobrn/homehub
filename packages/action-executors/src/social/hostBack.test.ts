import { type CalendarProvider } from '@homehub/providers-calendar';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createHostBackExecutor } from './hostBack.js';

interface MockCalendar extends CalendarProvider {
  createEvent: Mock;
}

function makeCalendar(): MockCalendar {
  return {
    listEvents: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
    createEvent: vi.fn(async () => ({ eventId: 'evt1', htmlLink: 'https://cal/1' })),
  } as unknown as MockCalendar;
}

describe('createHostBackExecutor', () => {
  it('inserts app.event row and skips gcal when mirror flag off', async () => {
    const { supabase, db } = makeFakeSupabase({ app: { event: [] } });
    const calendar = makeCalendar();
    const executor = createHostBackExecutor({ supabase, calendar });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'host_back' }),
      suggestion: makeSuggestion({
        kind: 'host_back',
        preview: {
          person_node_id: '9b47f48a-27e1-4b52-a24c-2d6b7b9e5d80',
          title: 'Dinner with Alex',
          starts_at: '2026-04-25T18:00:00Z',
          ends_at: '2026-04-25T21:00:00Z',
        },
      }),
      supabase,
    });

    expect(db.app!.event).toHaveLength(1);
    expect(db.app!.event![0]!.kind).toBe('hosting_back');
    expect(calendar.createEvent).not.toHaveBeenCalled();
    expect((result.result as { event_id: string }).event_id).toBeTruthy();
  });

  it('mirrors to gcal when requested and connection exists', async () => {
    const { supabase } = makeFakeSupabase({
      app: { event: [], member: [{ id: 'm1', role: 'owner' }] },
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
    });
    const calendar = makeCalendar();
    const executor = createHostBackExecutor({ supabase, calendar });

    const result = await runExecutor(executor, {
      action: makeAction(),
      suggestion: makeSuggestion({
        preview: {
          person_node_id: '9b47f48a-27e1-4b52-a24c-2d6b7b9e5d80',
          title: 'Dinner with Alex',
          starts_at: '2026-04-25T18:00:00Z',
          mirror_to_gcal: true,
        },
      }),
      supabase,
    });

    expect(calendar.createEvent).toHaveBeenCalled();
    expect((result.result as { gcal?: unknown }).gcal).toBeTruthy();
  });
});
