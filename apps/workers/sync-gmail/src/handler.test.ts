/**
 * Unit tests for the sync-gmail handler.
 *
 * Strategy: stub every external — Supabase (schema/from/select/upsert),
 * Storage (bucket upload), QueueClient, and the EmailProvider. We don't
 * hit any real network or database.
 */

import {
  type EmailMessage,
  type EmailProvider,
  HistoryIdExpiredError,
  RateLimitError,
} from '@homehub/providers-email';
import { type Logger, type QueueClient, queueNames } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_ATTACHMENTS_BUCKET, EMAIL_PROVIDER } from './email-db.js';
import {
  CURSOR_KIND,
  classifyCategories,
  pollOnce,
  readCategoriesFromMetadata,
} from './handler.js';

import type { Json } from '@homehub/db';

// ---- Fakes -------------------------------------------------------------

function makeLog(): Logger {
  const noop = () => {};
  const base = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => base,
  } as Logger;
  return base;
}

interface PageLike {
  messages: EmailMessage[];
  nextHistoryId?: string;
}

function makeEmailProvider(
  pages: AsyncIterable<PageLike>,
  overrides?: Partial<EmailProvider>,
): EmailProvider {
  const base: EmailProvider = {
    listRecentMessages: () => pages,
    fetchMessage: vi.fn(),
    fetchFullBody: vi.fn(async () => ({ bodyText: '' })),
    fetchAttachment: vi.fn(async () => ({
      contentBase64: Buffer.from('hello').toString('base64'),
      contentType: 'application/pdf',
      sizeBytes: 5,
    })),
    watch: vi.fn(),
    unwatch: vi.fn(),
    addLabel: vi.fn(async () => {}),
    ensureLabel: vi.fn(async () => ({ labelId: 'Label_Ingested' })),
    createDraft: vi.fn(async () => ({ draftId: 'd1', threadId: 't1', messageId: 'm1' })),
  };
  return { ...base, ...(overrides ?? {}) };
}

function asyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          return i < items.length
            ? { value: items[i++]!, done: false }
            : { value: undefined as never, done: true };
        },
      };
    },
  };
}

function throwingIterable(err: Error): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw err;
        },
      };
    },
  };
}

interface ConnectionRow {
  id: string;
  household_id: string;
  member_id: string | null;
  provider: string;
  nango_connection_id: string;
  status: string;
  metadata: Json | null;
}

function makeSupabase(opts: {
  connection: ConnectionRow;
  cursorValue?: string;
  emailUpsertRows?: Array<{ id: string; source_id: string }>;
}) {
  const cursorUpserts: Array<Record<string, unknown>> = [];
  const cursorDeletes: Array<Record<string, unknown>> = [];
  const emailUpserts: Array<Record<string, unknown>[]> = [];
  const emailAttachmentInserts: Array<Record<string, unknown>> = [];
  const connectionUpdates: Array<Record<string, unknown>> = [];
  const auditInserts: Array<Record<string, unknown>> = [];
  const storageUploads: Array<{ bucket: string; path: string; size: number }> = [];

  const schemaSync = {
    from(table: string): unknown {
      if (table === 'provider_connection') {
        return {
          select() {
            return this;
          },
          eq(): unknown {
            return this;
          },
          maybeSingle: async () => ({ data: opts.connection, error: null }),
          update(payload: Record<string, unknown>) {
            connectionUpdates.push(payload);
            return {
              eq: async () => ({ data: null, error: null }),
            };
          },
        };
      }
      if (table === 'cursor') {
        let whereKind: string | undefined;
        return {
          select() {
            return this;
          },
          eq(col: string, val: unknown) {
            if (col === 'kind') whereKind = String(val);
            return this;
          },
          maybeSingle: async () => {
            if (whereKind === CURSOR_KIND.historyId && opts.cursorValue) {
              return {
                data: { kind: CURSOR_KIND.historyId, value: opts.cursorValue },
                error: null,
              };
            }
            return { data: null, error: null };
          },
          upsert(payload: Record<string, unknown>) {
            cursorUpserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
          delete() {
            const chain = {
              eq: function () {
                cursorDeletes.push({});
                return chain;
              },
              then(resolve: (v: unknown) => void) {
                resolve({ data: null, error: null });
                return undefined;
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`unexpected sync.${table}`);
    },
  };

  const schemaApp = {
    from(table: string): unknown {
      if (table === 'email') {
        return {
          upsert(rows: Record<string, unknown>[]) {
            emailUpserts.push(rows);
            return {
              select: async () => ({ data: opts.emailUpsertRows ?? [], error: null }),
            };
          },
        };
      }
      if (table === 'email_attachment') {
        return {
          insert: async (row: Record<string, unknown>) => {
            emailAttachmentInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected app.${table}`);
    },
  };

  const schemaAudit = {
    from(table: string): unknown {
      if (table !== 'event') throw new Error(`unexpected audit.${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          auditInserts.push(row);
          return { data: null, error: null };
        },
      };
    },
  };

  const storage = {
    from(bucket: string) {
      return {
        upload: async (path: string, data: Buffer, _options?: unknown) => {
          storageUploads.push({ bucket, path, size: data.byteLength });
          return { data: null, error: null };
        },
      };
    },
  };

  const supabase = {
    schema(name: string) {
      if (name === 'sync') return schemaSync;
      if (name === 'app') return schemaApp;
      if (name === 'audit') return schemaAudit;
      throw new Error(`unexpected schema ${name}`);
    },
    storage,
  };

  return {
    supabase,
    cursorUpserts,
    cursorDeletes,
    emailUpserts,
    emailAttachmentInserts,
    connectionUpdates,
    auditInserts,
    storageUploads,
  };
}

function makeQueues(opts?: { claim?: unknown }) {
  const acks: Array<{ queue: string; id: number }> = [];
  const nacks: Array<{ queue: string; id: number; retryDelaySec?: number }> = [];
  const sends: Array<{ queue: string; payload: unknown }> = [];
  const batchSends: Array<{ queue: string; payloads: unknown[] }> = [];
  const deadLetters: Array<{ queue: string; id: number; reason: string }> = [];

  const claimFn = vi.fn().mockImplementation(async (queue: string) => {
    const claim = opts?.claim as { queue: string; msg: unknown } | undefined;
    if (!claim) return null;
    if (claim.queue !== queue) return null;
    return claim.msg;
  });

  const queues: QueueClient = {
    claim: claimFn,
    ack: vi.fn(async (queue, id) => {
      acks.push({ queue, id });
    }),
    nack: vi.fn(async (queue, id, options) => {
      nacks.push({
        queue,
        id,
        ...(options?.retryDelaySec ? { retryDelaySec: options.retryDelaySec } : {}),
      });
    }),
    send: vi.fn(async (queue, payload) => {
      sends.push({ queue, payload });
      return 1;
    }),
    sendBatch: vi.fn(async (queue, payloads) => {
      batchSends.push({ queue, payloads });
      return payloads.map((_p: unknown, i: number) => i + 1);
    }),
    deadLetter: vi.fn(async (queue, id, reason) => {
      deadLetters.push({ queue, id, reason });
    }),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;

  return { queues, acks, nacks, sends, batchSends, deadLetters };
}

const CONNECTION_ID = 'c0000000-0000-4000-8000-000000000001';
const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const MEMBER_ID = 'b0000000-0000-4000-8000-000000000001';
const EMAIL_ID_1 = '10000000-0000-4000-8000-000000000001';
const EMAIL_ID_2 = '10000000-0000-4000-8000-000000000002';

const CONNECTION: ConnectionRow = {
  id: CONNECTION_ID,
  household_id: HOUSEHOLD_ID,
  member_id: MEMBER_ID,
  provider: EMAIL_PROVIDER,
  nango_connection_id: 'nango-gmail-1',
  status: 'active',
  metadata: { email_categories: ['receipt', 'shipping'] },
};

function envelope(kind: 'sync.gmail.full' | 'sync.gmail.delta') {
  return {
    household_id: HOUSEHOLD_ID,
    kind,
    entity_id: CONNECTION_ID,
    version: 1,
    enqueued_at: '2026-04-20T12:00:00.000Z',
  };
}

function msg(id: string, subject = 'Your order shipped'): EmailMessage {
  return {
    sourceId: id,
    threadId: `t-${id}`,
    historyId: '9999',
    subject,
    fromEmail: 'shipment-tracking@amazon.com',
    fromName: 'Amazon',
    toEmails: ['alice@example.com'],
    receivedAt: '2026-04-20T11:00:00.000Z',
    labels: ['INBOX'],
    bodyPreview: 'Your order has shipped',
    headers: { subject, from: 'Amazon <shipment-tracking@amazon.com>' },
    attachments: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readCategoriesFromMetadata', () => {
  it('extracts valid categories, drops unknowns', () => {
    const out = readCategoriesFromMetadata({
      email_categories: ['receipt', 'unknown', 'invite', 'invite'],
    });
    expect(out).toEqual(['receipt', 'invite']);
  });

  it('returns empty on null / malformed', () => {
    expect(readCategoriesFromMetadata(null)).toEqual([]);
    expect(readCategoriesFromMetadata({})).toEqual([]);
    expect(readCategoriesFromMetadata({ email_categories: 'receipt' })).toEqual([]);
  });
});

describe('classifyCategories', () => {
  it('tags shipping on tracking subject', () => {
    const m = msg('m1', 'Your order shipped with tracking 1Z123');
    expect(classifyCategories(m, ['receipt', 'shipping'])).toContain('shipping');
  });

  it('tags invite when a .ics attachment is present', () => {
    const m = msg('m2', 'Birthday party');
    m.attachments = [
      { partId: '0.1', filename: 'invite.ics', contentType: 'text/calendar', sizeBytes: 100 },
    ];
    expect(classifyCategories(m, ['invite'])).toEqual(['invite']);
  });

  it('honors the member opt-in set — even if keywords match an off category', () => {
    const m = msg('m3', 'Your statement is ready');
    // Member only opted into 'receipt'; 'bill' would match but is excluded.
    expect(classifyCategories(m, ['receipt'])).toEqual([]);
  });
});

describe('pollOnce — happy path (sync_full) with attachments', () => {
  it('upserts, uploads attachment, labels, enqueues enrichment, writes cursor, acks', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const withAttachment = msg('e1');
    withAttachment.attachments = [
      {
        partId: 'att-1',
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1234,
      },
    ];
    const pages = asyncIterable<PageLike>([
      { messages: [withAttachment, msg('e2', 'Order confirmation')], nextHistoryId: '10000' },
    ]);

    const fullQ = queueNames.syncFull(EMAIL_PROVIDER);
    const { queues, acks, batchSends } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 42,
          readCount: 1,
          enqueuedAt: '2026-04-20T11:59:00Z',
          vt: 'now',
          payload: envelope('sync.gmail.full'),
        },
      },
    });

    const {
      supabase,
      cursorUpserts,
      emailUpserts,
      emailAttachmentInserts,
      connectionUpdates,
      auditInserts,
      storageUploads,
    } = makeSupabase({
      connection: CONNECTION,
      emailUpsertRows: [
        { id: EMAIL_ID_1, source_id: 'e1' },
        { id: EMAIL_ID_2, source_id: 'e2' },
      ],
    });

    const email = makeEmailProvider(pages);
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      email,
      log: makeLog(),
      ingestionEnabled: true,
      now: () => now,
    });

    expect(result).toBe('claimed');
    expect(emailUpserts[0]).toHaveLength(2);
    expect(emailUpserts[0]?.[0]).toMatchObject({
      provider: EMAIL_PROVIDER,
      source_id: 'e1',
      segment: 'system',
      household_id: HOUSEHOLD_ID,
    });
    expect(storageUploads).toHaveLength(1);
    expect(storageUploads[0]?.bucket).toBe(EMAIL_ATTACHMENTS_BUCKET);
    expect(storageUploads[0]?.path.startsWith(`${HOUSEHOLD_ID}/email/${EMAIL_ID_1}/`)).toBe(true);
    expect(emailAttachmentInserts).toHaveLength(1);
    expect(emailAttachmentInserts[0]).toMatchObject({
      email_id: EMAIL_ID_1,
      filename: 'receipt.pdf',
    });
    expect(batchSends[0]?.queue).toBe(queueNames.enrichEmail);
    expect(batchSends[0]?.payloads).toHaveLength(2);
    expect(cursorUpserts).toHaveLength(1);
    expect(cursorUpserts[0]).toMatchObject({
      value: '10000',
      kind: CURSOR_KIND.historyId,
    });
    expect(connectionUpdates).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({ action: 'sync.gmail.full.completed' });
    expect(acks).toEqual([{ queue: fullQ, id: 42 }]);
    expect(email.ensureLabel).toHaveBeenCalledTimes(1);
    expect(email.addLabel).toHaveBeenCalledTimes(2);
  });
});

describe('pollOnce — sync_delta happy', () => {
  it('reads history id cursor and uses afterHistoryId in the adapter call', async () => {
    const pages = asyncIterable<PageLike>([{ messages: [msg('d1')], nextHistoryId: '20000' }]);
    const deltaQ = queueNames.syncDelta(EMAIL_PROVIDER);
    const { queues } = makeQueues({
      claim: {
        queue: deltaQ,
        msg: {
          messageId: 7,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gmail.delta'),
        },
      },
    });

    const { supabase, cursorUpserts } = makeSupabase({
      connection: CONNECTION,
      cursorValue: '15000',
      emailUpsertRows: [{ id: EMAIL_ID_1, source_id: 'd1' }],
    });

    const listSpy = vi.fn(() => pages);
    const email = makeEmailProvider(pages, {
      listRecentMessages: listSpy as unknown as EmailProvider['listRecentMessages'],
    });

    await pollOnce({
      supabase: supabase as never,
      queues,
      email,
      log: makeLog(),
      ingestionEnabled: true,
    });

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        afterHistoryId: '15000',
        connectionId: 'nango-gmail-1',
      }),
    );
    expect(cursorUpserts[0]?.value).toBe('20000');
  });
});

describe('pollOnce — HistoryIdExpired', () => {
  it('clears cursor, requeues as full, acks delta', async () => {
    const deltaQ = queueNames.syncDelta(EMAIL_PROVIDER);
    const fullQ = queueNames.syncFull(EMAIL_PROVIDER);
    const { queues, acks, sends } = makeQueues({
      claim: {
        queue: deltaQ,
        msg: {
          messageId: 7,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gmail.delta'),
        },
      },
    });

    const { supabase, cursorDeletes, emailUpserts } = makeSupabase({
      connection: CONNECTION,
      cursorValue: 'old-hid',
    });

    const email = makeEmailProvider(throwingIterable(new HistoryIdExpiredError('404')));

    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      email,
      log: makeLog(),
      ingestionEnabled: true,
    });

    expect(result).toBe('claimed');
    expect(emailUpserts).toHaveLength(0);
    expect(cursorDeletes.length).toBeGreaterThan(0);
    expect(sends[0]?.queue).toBe(fullQ);
    expect(sends[0]?.payload).toMatchObject({ kind: 'sync.gmail.full' });
    expect(acks).toEqual([{ queue: deltaQ, id: 7 }]);
  });
});

describe('pollOnce — RateLimitError', () => {
  it('nacks with the retry-after delay', async () => {
    const deltaQ = queueNames.syncDelta(EMAIL_PROVIDER);
    const { queues, nacks, acks } = makeQueues({
      claim: {
        queue: deltaQ,
        msg: {
          messageId: 9,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gmail.delta'),
        },
      },
    });
    const { supabase } = makeSupabase({ connection: CONNECTION, cursorValue: 'hid' });
    const email = makeEmailProvider(throwingIterable(new RateLimitError('429', 73)));

    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      email,
      log: makeLog(),
      ingestionEnabled: true,
    });

    expect(result).toBe('claimed');
    expect(nacks).toEqual([{ queue: deltaQ, id: 9, retryDelaySec: 73 }]);
    expect(acks).toEqual([]);
  });
});

describe('pollOnce — feature flag off', () => {
  it('skips persistence + attachment upload + label calls, still acks and writes audit', async () => {
    const pages = asyncIterable<PageLike>([{ messages: [msg('e1')], nextHistoryId: '1234' }]);
    const fullQ = queueNames.syncFull(EMAIL_PROVIDER);
    const { queues, acks, batchSends } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 99,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gmail.full'),
        },
      },
    });
    const { supabase, emailUpserts, auditInserts, storageUploads } = makeSupabase({
      connection: CONNECTION,
    });
    const email = makeEmailProvider(pages);
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      email,
      log: makeLog(),
      ingestionEnabled: false,
    });

    expect(result).toBe('claimed');
    expect(emailUpserts).toHaveLength(0);
    expect(storageUploads).toHaveLength(0);
    expect(batchSends).toHaveLength(0);
    expect(email.ensureLabel).not.toHaveBeenCalled();
    expect(email.addLabel).not.toHaveBeenCalled();
    // Cursor + audit still written so ops can track the disabled-run.
    expect(auditInserts[0]).toMatchObject({ action: 'sync.gmail.full.completed' });
    expect(auditInserts[0]?.after).toMatchObject({ ingestion_enabled: false });
    expect(acks).toEqual([{ queue: fullQ, id: 99 }]);
  });
});

describe('pollOnce — idempotency', () => {
  it('two pages with the same email produce one upsert batch per page', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const fullQ = queueNames.syncFull(EMAIL_PROVIDER);
    const { queues } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 99,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gmail.full'),
        },
      },
    });
    const pages = asyncIterable<PageLike>([
      { messages: [msg('e1')] },
      { messages: [msg('e1', 'Order confirmation')], nextHistoryId: '10' },
    ]);
    const { supabase, emailUpserts } = makeSupabase({
      connection: CONNECTION,
      emailUpsertRows: [{ id: EMAIL_ID_1, source_id: 'e1' }],
    });
    const email = makeEmailProvider(pages);
    await pollOnce({
      supabase: supabase as never,
      queues,
      email,
      log: makeLog(),
      ingestionEnabled: true,
      now: () => now,
    });
    expect(emailUpserts).toHaveLength(2);
    // Upsert shape pins the conflict-key column set.
    expect(emailUpserts[0]?.[0]).toMatchObject({
      provider: EMAIL_PROVIDER,
      source_id: 'e1',
      household_id: HOUSEHOLD_ID,
    });
  });
});

describe('pollOnce — empty opt-in categories', () => {
  it('no-ops when the connection has no opted-in categories', async () => {
    const fullQ = queueNames.syncFull(EMAIL_PROVIDER);
    const { queues, acks, batchSends } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 1,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gmail.full'),
        },
      },
    });
    const { supabase, emailUpserts } = makeSupabase({
      connection: { ...CONNECTION, metadata: { email_categories: [] } },
    });
    const email = makeEmailProvider(asyncIterable<PageLike>([]));
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      email,
      log: makeLog(),
      ingestionEnabled: true,
    });
    expect(result).toBe('claimed');
    expect(emailUpserts).toHaveLength(0);
    expect(batchSends).toHaveLength(0);
    expect(acks).toEqual([{ queue: fullQ, id: 1 }]);
  });
});
