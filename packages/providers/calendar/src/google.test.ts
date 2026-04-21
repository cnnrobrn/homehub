/**
 * Unit tests for `GoogleCalendarProvider`.
 *
 * Strategy: mock the `NangoClient` entirely. We pin:
 *   - Normalization (all-day folding, attendee dedup, status mapping).
 *   - Pagination (multi-page → single yielded sync token).
 *   - 410 → `FullResyncRequiredError`.
 *   - 429 and 403-with-quotaExceeded → `RateLimitError` with retry-after.
 *   - `watch` channel-id prefix guard.
 */

import { NangoError, type NangoClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import { FullResyncRequiredError, RateLimitError } from './errors.js';
import { __internal, createGoogleCalendarProvider } from './google.js';

function makeNango(
  proxyImpl: (opts: {
    endpoint: string;
    method?: string;
    params?: Record<string, unknown>;
  }) => unknown,
): NangoClient {
  return {
    proxy: vi.fn(async (opts) => proxyImpl(opts) as never),
    getConnection: vi.fn(),
    listConnections: vi.fn(),
  } as unknown as NangoClient;
}

function makeNangoError(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): NangoError {
  return new NangoError(
    'proxy failed',
    { providerConfigKey: 'google-calendar', connectionId: 'c1' },
    {
      cause: { response: { status, data: body, headers: headers ?? {} } },
    },
  );
}

describe('normalizeEvent', () => {
  it('folds all-day events to midnight UTC', () => {
    const ev = __internal.normalizeEvent(
      {
        id: 'x',
        etag: '"e"',
        status: 'confirmed',
        start: { date: '2026-04-20' },
        end: { date: '2026-04-21' },
      },
      'owner@example.com',
    );
    expect(ev).toMatchObject({ allDay: true, startsAt: '2026-04-20T00:00:00.000Z' });
  });

  it('preserves timed events with their ISO strings', () => {
    const ev = __internal.normalizeEvent(
      {
        id: 'x',
        etag: '"e"',
        status: 'confirmed',
        start: { dateTime: '2026-04-20T14:00:00-07:00' },
        end: { dateTime: '2026-04-20T15:00:00-07:00' },
      },
      'owner@example.com',
    );
    expect(ev?.allDay).toBe(false);
    expect(ev?.startsAt).toBe('2026-04-20T14:00:00-07:00');
  });

  it('dedupes attendees by lower-cased email', () => {
    const deduped = __internal.dedupAttendees([
      { email: 'Alice@Example.com', displayName: 'Alice' },
      { email: 'alice@example.com', displayName: 'Alice2' },
      { email: 'bob@example.com' },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]?.email).toBe('alice@example.com');
    expect(deduped[0]?.displayName).toBe('Alice');
  });

  it('defaults status to confirmed for unknown values', () => {
    const ev = __internal.normalizeEvent(
      { id: 'x', status: 'garbage', start: { dateTime: '2026-01-01T00:00:00Z' } },
      'o@e.com',
    );
    expect(ev?.status).toBe('confirmed');
  });

  it('returns null if the event has no id or no start', () => {
    expect(__internal.normalizeEvent({}, 'o@e.com')).toBeNull();
    expect(__internal.normalizeEvent({ id: 'x' }, 'o@e.com')).toBeNull();
  });
});

describe('parseRetryAfter', () => {
  it('accepts seconds as a number string', () => {
    expect(__internal.parseRetryAfter('42')).toBe(42);
  });
  it('defaults to 60 when absent or unparseable', () => {
    expect(__internal.parseRetryAfter(undefined)).toBe(60);
    expect(__internal.parseRetryAfter('not-a-date')).toBe(60);
  });
});

describe('listEvents', () => {
  it('fetches the primary calendar owner once, then emits events per page', async () => {
    const calls: Array<{ endpoint: string; params?: Record<string, unknown> }> = [];
    const nango = makeNango((opts) => {
      calls.push({ endpoint: opts.endpoint, ...(opts.params ? { params: opts.params } : {}) });
      if (opts.endpoint === '/calendar/v3/calendars/primary') {
        return { id: 'owner@example.com' };
      }
      // Single-page response with a sync token.
      return {
        items: [
          {
            id: 'e1',
            etag: '"1"',
            status: 'confirmed',
            summary: 'Team standup',
            start: { dateTime: '2026-04-20T09:00:00-07:00' },
            end: { dateTime: '2026-04-20T09:30:00-07:00' },
          },
          {
            id: 'e2',
            etag: '"2"',
            status: 'cancelled',
            summary: 'Old meeting',
            start: { dateTime: '2026-04-21T09:00:00-07:00' },
            end: { dateTime: '2026-04-21T09:30:00-07:00' },
          },
        ],
        nextSyncToken: 'st-next',
      };
    });

    const provider = createGoogleCalendarProvider({ nango });
    const pages: Array<{ events: number; syncToken?: string }> = [];
    for await (const page of provider.listEvents({
      connectionId: 'c1',
      timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-12-31T23:59:59Z',
    })) {
      pages.push({
        events: page.events.length,
        ...(page.nextSyncToken ? { syncToken: page.nextSyncToken } : {}),
      });
    }
    expect(pages).toEqual([{ events: 2, syncToken: 'st-next' }]);
    // Owner resolution + one events call.
    expect(calls.map((c) => c.endpoint)).toEqual([
      '/calendar/v3/calendars/primary',
      '/calendar/v3/calendars/primary/events',
    ]);
  });

  it('follows pagination and only yields a sync token on the final page', async () => {
    let call = 0;
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/calendar/v3/calendars/primary') return { id: 'o@e.com' };
      call += 1;
      if (call === 1) {
        return {
          items: [
            {
              id: 'a',
              etag: '"a"',
              status: 'confirmed',
              start: { dateTime: '2026-01-01T00:00:00Z' },
            },
          ],
          nextPageToken: 'pt-2',
        };
      }
      return {
        items: [
          {
            id: 'b',
            etag: '"b"',
            status: 'confirmed',
            start: { dateTime: '2026-01-02T00:00:00Z' },
          },
        ],
        nextSyncToken: 'st-final',
      };
    });
    const provider = createGoogleCalendarProvider({ nango });
    const pages: Array<{ ids: string[]; syncToken?: string }> = [];
    for await (const page of provider.listEvents({
      connectionId: 'c1',
      timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-12-31T23:59:59Z',
    })) {
      pages.push({
        ids: page.events.map((e) => e.sourceId),
        ...(page.nextSyncToken ? { syncToken: page.nextSyncToken } : {}),
      });
    }
    expect(pages).toEqual([{ ids: ['a'] }, { ids: ['b'], syncToken: 'st-final' }]);
  });

  it('uses syncToken when supplied and omits time bounds', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/calendar/v3/calendars/primary') return { id: 'o@e.com' };
      calls.push(opts.params ?? {});
      return { items: [], nextSyncToken: 'st-new' };
    });
    const provider = createGoogleCalendarProvider({ nango });
    const it = provider.listEvents({
      connectionId: 'c1',
      timeMin: 'ignored',
      timeMax: 'ignored',
      syncToken: 'st-old',
    });
    for await (const _ of it) {
      // drain
    }
    expect(calls[0]).toMatchObject({ syncToken: 'st-old' });
    expect(calls[0]).not.toHaveProperty('timeMin');
    expect(calls[0]).not.toHaveProperty('timeMax');
  });

  it('maps 410 Gone to FullResyncRequiredError', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/calendar/v3/calendars/primary') return { id: 'o@e.com' };
      throw makeNangoError(410, { error: { code: 410, message: 'gone' } });
    });
    const provider = createGoogleCalendarProvider({ nango });
    await expect(async () => {
      for await (const _ of provider.listEvents({
        connectionId: 'c1',
        timeMin: 'a',
        timeMax: 'b',
        syncToken: 'st',
      })) {
        // drain
      }
    }).rejects.toBeInstanceOf(FullResyncRequiredError);
  });

  it('maps 429 to RateLimitError with Retry-After seconds', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/calendar/v3/calendars/primary') return { id: 'o@e.com' };
      throw makeNangoError(429, { error: { code: 429 } }, { 'retry-after': '45' });
    });
    const provider = createGoogleCalendarProvider({ nango });
    try {
      for await (const _ of provider.listEvents({
        connectionId: 'c1',
        timeMin: 'a',
        timeMax: 'b',
      })) {
        // drain
      }
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterSeconds).toBe(45);
    }
  });

  it('maps 403 quotaExceeded to RateLimitError', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/calendar/v3/calendars/primary') return { id: 'o@e.com' };
      throw makeNangoError(403, {
        error: { code: 403, errors: [{ reason: 'quotaExceeded' }] },
      });
    });
    const provider = createGoogleCalendarProvider({ nango });
    await expect(async () => {
      for await (const _ of provider.listEvents({
        connectionId: 'c1',
        timeMin: 'a',
        timeMax: 'b',
      })) {
        // drain
      }
    }).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('watch', () => {
  it('rejects a channelId without the hh-gcal- prefix', async () => {
    const nango = makeNango(() => ({}));
    const provider = createGoogleCalendarProvider({ nango });
    await expect(
      provider.watch({
        connectionId: 'c1',
        channelId: 'bad-id',
        webhookUrl: 'https://example.com/h',
      }),
    ).rejects.toThrow(/hh-gcal-/);
  });

  it('calls events.watch and returns the normalized result', async () => {
    const nango = makeNango(() => ({
      id: 'hh-gcal-xyz',
      resourceId: 'res-1',
      expiration: '1700000000000',
    }));
    const provider = createGoogleCalendarProvider({ nango });
    const result = await provider.watch({
      connectionId: 'c1',
      channelId: 'hh-gcal-xyz',
      webhookUrl: 'https://example.com/h',
      ttlSeconds: 3600,
    });
    expect(result.channelId).toBe('hh-gcal-xyz');
    expect(result.resourceId).toBe('res-1');
    expect(result.expiration).toBe(new Date(1_700_000_000_000).toISOString());
  });
});
