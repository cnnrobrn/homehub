/**
 * Unit tests for `GoogleMailProvider`.
 *
 * Strategy: mock the `NangoClient` entirely. Pins:
 *   - Normalization (subject/from/to/date parsing, attachments, preview cap).
 *   - Pagination via search (multi-page → single nextHistoryId).
 *   - History.list 404 → `HistoryIdExpiredError`.
 *   - 429 and 403-rateLimitExceeded → `RateLimitError` with retry-after.
 *   - `ensureLabel` caches across calls.
 *   - `addLabel` / `watch` / `unwatch` call shape.
 */

import { NangoError, type NangoClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import { EmailSyncError, HistoryIdExpiredError, RateLimitError } from './errors.js';
import {
  BODY_PREVIEW_MAX_BYTES,
  __internal,
  createGoogleMailProvider,
  HOMEHUB_INGESTED_LABEL_NAME,
} from './google.js';
import { buildGmailQuery } from './query.js';

function makeNango(
  proxyImpl: (opts: {
    endpoint: string;
    method?: string;
    params?: Record<string, unknown>;
    data?: unknown;
  }) => unknown,
): NangoClient {
  return {
    proxy: vi.fn(async (opts) => proxyImpl(opts) as never),
    getConnection: vi.fn(),
    listConnections: vi.fn(),
    createConnectSession: vi.fn(),
    deleteConnection: vi.fn(),
  } as unknown as NangoClient;
}

function makeNangoError(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): NangoError {
  return new NangoError(
    'proxy failed',
    { providerConfigKey: 'google-mail', connectionId: 'c1' },
    { cause: { response: { status, data: body, headers: headers ?? {} } } },
  );
}

function base64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

describe('parseFromAddress', () => {
  it('parses "Name <email@x>" correctly', () => {
    expect(__internal.parseFromAddress('"Alice Jones" <alice@example.com>')).toEqual({
      email: 'alice@example.com',
      name: 'Alice Jones',
    });
  });

  it('parses bare email', () => {
    expect(__internal.parseFromAddress('bob@example.com')).toEqual({ email: 'bob@example.com' });
  });

  it('returns empty email for undefined', () => {
    expect(__internal.parseFromAddress(undefined)).toEqual({ email: '' });
  });
});

describe('normalizeMessage', () => {
  it('extracts headers, from, recipients, and snippet', () => {
    const msg = __internal.normalizeMessage({
      id: 'm1',
      threadId: 't1',
      historyId: '1000',
      labelIds: ['INBOX', 'IMPORTANT'],
      internalDate: String(Date.parse('2026-04-20T12:00:00Z')),
      snippet: 'Your order has shipped',
      payload: {
        headers: [
          { name: 'Subject', value: 'Order shipped' },
          { name: 'From', value: '"Amazon" <shipment-tracking@amazon.com>' },
          { name: 'To', value: 'alice@example.com, bob@example.com' },
          { name: 'Date', value: 'Mon, 20 Apr 2026 12:00:00 +0000' },
          { name: 'Message-Id', value: '<abc@x>' },
        ],
      },
    });
    expect(msg).not.toBeNull();
    expect(msg).toMatchObject({
      sourceId: 'm1',
      threadId: 't1',
      historyId: '1000',
      subject: 'Order shipped',
      fromEmail: 'shipment-tracking@amazon.com',
      fromName: 'Amazon',
      toEmails: ['alice@example.com', 'bob@example.com'],
      labels: ['INBOX', 'IMPORTANT'],
      bodyPreview: 'Your order has shipped',
    });
    expect(msg?.receivedAt).toBe(new Date(Date.parse('2026-04-20T12:00:00Z')).toISOString());
    expect(msg?.headers['message-id']).toBe('<abc@x>');
  });

  it('prefers text/plain part over snippet for preview', () => {
    const msg = __internal.normalizeMessage({
      id: 'm2',
      threadId: 't2',
      snippet: 'snippet-fallback',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [{ name: 'Subject', value: 'Hi' }],
        parts: [
          {
            mimeType: 'text/plain',
            body: { data: base64urlEncode('Hello from plain text') },
          },
          {
            mimeType: 'text/html',
            body: { data: base64urlEncode('<p>HTML</p>') },
          },
        ],
      },
    });
    expect(msg?.bodyPreview).toBe('Hello from plain text');
  });

  it('falls back to text/html stripped of tags', () => {
    const msg = __internal.normalizeMessage({
      id: 'm3',
      threadId: 't3',
      payload: {
        parts: [
          {
            mimeType: 'text/html',
            body: { data: base64urlEncode('<p>Hello <b>world</b></p>') },
          },
        ],
      },
    });
    expect(msg?.bodyPreview).toBe('Hello world');
  });

  it('caps body preview at 2KB', () => {
    const big = 'x'.repeat(BODY_PREVIEW_MAX_BYTES + 500);
    const msg = __internal.normalizeMessage({
      id: 'm4',
      threadId: 't4',
      payload: {
        parts: [{ mimeType: 'text/plain', body: { data: base64urlEncode(big) } }],
      },
    });
    expect(Buffer.byteLength(msg?.bodyPreview ?? '', 'utf8')).toBeLessThanOrEqual(
      BODY_PREVIEW_MAX_BYTES,
    );
  });

  it('collects attachments with filenames', () => {
    const msg = __internal.normalizeMessage({
      id: 'm5',
      threadId: 't5',
      payload: {
        parts: [
          {
            partId: '0.1',
            filename: 'receipt.pdf',
            mimeType: 'application/pdf',
            body: { attachmentId: 'att-1', size: 12345 },
          },
          {
            partId: '0.2',
            filename: '',
            mimeType: 'image/png',
            body: { attachmentId: 'inline-skip', size: 100 },
          },
        ],
      },
    });
    expect(msg?.attachments).toEqual([
      {
        partId: '0.1',
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
        sizeBytes: 12345,
      },
    ]);
  });

  it('returns null on missing identifiers', () => {
    expect(__internal.normalizeMessage({})).toBeNull();
    expect(__internal.normalizeMessage({ id: 'x' })).toBeNull();
  });
});

describe('parseRetryAfter', () => {
  it('accepts numeric seconds', () => {
    expect(__internal.parseRetryAfter('42')).toBe(42);
  });
  it('defaults to 60 for unparseable', () => {
    expect(__internal.parseRetryAfter(undefined)).toBe(60);
    expect(__internal.parseRetryAfter('nope')).toBe(60);
  });
});

describe('buildGmailQuery', () => {
  it('returns empty string when no categories opted in', () => {
    expect(buildGmailQuery({ categories: [] })).toBe('');
  });
  it('includes inbox scoping, window, and the ingest-exclusion by default', () => {
    const q = buildGmailQuery({ categories: ['receipt'], withinDays: 180 });
    expect(q).toContain('in:inbox');
    expect(q).toContain('newer_than:180d');
    expect(q).toContain('-label:HomeHub/Ingested');
    expect(q).toContain('receipt');
  });
  it('joins multiple categories with OR', () => {
    const q = buildGmailQuery({ categories: ['receipt', 'shipping'] });
    expect(q).toMatch(/receipt[\s\S]*OR[\s\S]*ship/);
  });
});

describe('listRecentMessages — search path', () => {
  it('resolves ids then fetches each message, yielding one page with the highest historyId', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/gmail/v1/users/me/messages') {
        return {
          messages: [
            { id: 'm1', threadId: 't1' },
            { id: 'm2', threadId: 't2' },
          ],
        };
      }
      if (opts.endpoint.startsWith('/gmail/v1/users/me/messages/m1')) {
        return {
          id: 'm1',
          threadId: 't1',
          historyId: '100',
          snippet: 'one',
          internalDate: '1700000000000',
          payload: {
            headers: [
              { name: 'Subject', value: 'one' },
              { name: 'From', value: 'a@x' },
            ],
          },
        };
      }
      if (opts.endpoint.startsWith('/gmail/v1/users/me/messages/m2')) {
        return {
          id: 'm2',
          threadId: 't2',
          historyId: '200',
          snippet: 'two',
          internalDate: '1700000001000',
          payload: { headers: [{ name: 'From', value: 'b@x' }] },
        };
      }
      throw new Error(`unexpected ${opts.endpoint}`);
    });
    const provider = createGoogleMailProvider({ nango });
    const pages: Array<{ ids: string[]; historyId?: string }> = [];
    for await (const p of provider.listRecentMessages({
      connectionId: 'c1',
      query: 'in:inbox',
    })) {
      pages.push({
        ids: p.messages.map((m) => m.sourceId),
        ...(p.nextHistoryId ? { historyId: p.nextHistoryId } : {}),
      });
    }
    expect(pages).toEqual([{ ids: ['m1', 'm2'], historyId: '200' }]);
  });

  it('walks nextPageToken and only yields historyId on the terminal page', async () => {
    let call = 0;
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/gmail/v1/users/me/messages') {
        call += 1;
        if (call === 1) {
          return { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'pt2' };
        }
        return { messages: [{ id: 'm2', threadId: 't2' }] };
      }
      const idMatch = opts.endpoint.match(/messages\/([^/]+)/);
      const id = idMatch?.[1] ?? '';
      return {
        id,
        threadId: `t-${id}`,
        historyId: id === 'm2' ? '300' : '100',
        payload: { headers: [] },
      };
    });
    const provider = createGoogleMailProvider({ nango });
    const pages: Array<{ ids: string[]; historyId?: string }> = [];
    for await (const p of provider.listRecentMessages({
      connectionId: 'c1',
      query: 'in:inbox',
    })) {
      pages.push({
        ids: p.messages.map((m) => m.sourceId),
        ...(p.nextHistoryId ? { historyId: p.nextHistoryId } : {}),
      });
    }
    expect(pages).toEqual([{ ids: ['m1'] }, { ids: ['m2'], historyId: '300' }]);
  });

  it('maps 429 to RateLimitError with Retry-After seconds', async () => {
    const nango = makeNango((_opts) => {
      throw makeNangoError(429, { error: { code: 429 } }, { 'retry-after': '45' });
    });
    const provider = createGoogleMailProvider({ nango });
    try {
      for await (const _ of provider.listRecentMessages({ connectionId: 'c1', query: 'x' })) {
        // drain
      }
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterSeconds).toBe(45);
    }
  });

  it('maps 403 rateLimitExceeded to RateLimitError', async () => {
    const nango = makeNango((_opts) => {
      throw makeNangoError(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } });
    });
    const provider = createGoogleMailProvider({ nango });
    await expect(async () => {
      for await (const _ of provider.listRecentMessages({ connectionId: 'c1', query: 'x' })) {
        // drain
      }
    }).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('listRecentMessages — history path', () => {
  it('404 on history.list → HistoryIdExpiredError', async () => {
    const nango = makeNango((_opts) => {
      throw makeNangoError(404, { error: { code: 404 } });
    });
    const provider = createGoogleMailProvider({ nango });
    await expect(async () => {
      for await (const _ of provider.listRecentMessages({
        connectionId: 'c1',
        query: 'in:inbox',
        afterHistoryId: '1000',
      })) {
        // drain
      }
    }).rejects.toBeInstanceOf(HistoryIdExpiredError);
  });

  it('drains added message ids then fetches each', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/gmail/v1/users/me/history') {
        return {
          history: [
            { id: '2', messagesAdded: [{ message: { id: 'mh1' } }] },
            { id: '3', messagesAdded: [{ message: { id: 'mh2' } }] },
          ],
          historyId: '3',
        };
      }
      const idMatch = opts.endpoint.match(/messages\/([^/]+)/);
      const id = idMatch?.[1] ?? '';
      return { id, threadId: `t-${id}`, historyId: '3', payload: { headers: [] } };
    });
    const provider = createGoogleMailProvider({ nango });
    const pages: Array<{ ids: string[]; historyId?: string }> = [];
    for await (const p of provider.listRecentMessages({
      connectionId: 'c1',
      query: 'unused-for-history',
      afterHistoryId: '1',
    })) {
      pages.push({
        ids: p.messages.map((m) => m.sourceId),
        ...(p.nextHistoryId ? { historyId: p.nextHistoryId } : {}),
      });
    }
    expect(pages[0]?.ids.sort()).toEqual(['mh1', 'mh2']);
    expect(pages[0]?.historyId).toBe('3');
  });
});

describe('ensureLabel', () => {
  it('reuses an existing label and caches it for subsequent calls', async () => {
    const listSpy = vi.fn(() => ({
      labels: [{ id: 'Label_1', name: HOMEHUB_INGESTED_LABEL_NAME }],
    }));
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/gmail/v1/users/me/labels' && (opts.method ?? 'GET') === 'GET') {
        return listSpy();
      }
      return {};
    });
    const provider = createGoogleMailProvider({ nango });
    const r1 = await provider.ensureLabel({
      connectionId: 'c1',
      name: HOMEHUB_INGESTED_LABEL_NAME,
    });
    const r2 = await provider.ensureLabel({
      connectionId: 'c1',
      name: HOMEHUB_INGESTED_LABEL_NAME,
    });
    expect(r1.labelId).toBe('Label_1');
    expect(r2.labelId).toBe('Label_1');
    // Cache hit on second call → list fetched only once.
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('creates the label when missing', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/gmail/v1/users/me/labels' && (opts.method ?? 'GET') === 'GET') {
        return { labels: [] };
      }
      if (opts.endpoint === '/gmail/v1/users/me/labels' && opts.method === 'POST') {
        return { id: 'Label_99', name: HOMEHUB_INGESTED_LABEL_NAME };
      }
      throw new Error(`unexpected ${opts.endpoint} ${opts.method}`);
    });
    const provider = createGoogleMailProvider({ nango });
    const r = await provider.ensureLabel({
      connectionId: 'c1',
      name: HOMEHUB_INGESTED_LABEL_NAME,
    });
    expect(r.labelId).toBe('Label_99');
  });
});

describe('addLabel / watch / unwatch', () => {
  it('addLabel calls messages.modify with addLabelIds', async () => {
    const calls: Array<{ endpoint: string; method?: string; data?: unknown }> = [];
    const nango = makeNango((opts) => {
      calls.push({
        endpoint: opts.endpoint,
        ...(opts.method ? { method: opts.method } : {}),
        ...(opts.data ? { data: opts.data } : {}),
      });
      return {};
    });
    const provider = createGoogleMailProvider({ nango });
    await provider.addLabel({ connectionId: 'c1', messageId: 'm1', labelId: 'Label_1' });
    expect(calls[0]).toMatchObject({
      endpoint: '/gmail/v1/users/me/messages/m1/modify',
      method: 'POST',
      data: { addLabelIds: ['Label_1'] },
    });
  });

  it('watch returns historyId + expiration', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint === '/gmail/v1/users/me/watch') {
        return { historyId: '9999', expiration: '1734567890000' };
      }
      throw new Error('unexpected');
    });
    const provider = createGoogleMailProvider({ nango });
    const r = await provider.watch({
      connectionId: 'c1',
      topicName: 'projects/p/topics/t',
      labelIds: ['INBOX'],
    });
    expect(r.historyId).toBe('9999');
    expect(r.expiration).toBe(new Date(1_734_567_890_000).toISOString());
  });

  it('unwatch swallows 404', async () => {
    const nango = makeNango(() => {
      throw makeNangoError(404, {});
    });
    const provider = createGoogleMailProvider({ nango });
    await expect(provider.unwatch({ connectionId: 'c1' })).resolves.toBeUndefined();
  });

  it('fetchMessage propagates EmailSyncError when message id is missing', async () => {
    const nango = makeNango(() => ({ threadId: 't1' }));
    const provider = createGoogleMailProvider({ nango });
    await expect(
      provider.fetchMessage({ connectionId: 'c1', messageId: 'm1' }),
    ).rejects.toBeInstanceOf(EmailSyncError);
  });
});
