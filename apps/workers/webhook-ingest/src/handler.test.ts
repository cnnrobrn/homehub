/**
 * Unit tests for the webhook-ingest handler.
 *
 * Four categories:
 *   1. Google Calendar push — valid channel, unknown channel, missing headers.
 *   2. Google Mail Pub/Sub push — auth, unknown account, happy path.
 *   3. Nango webhook — gcal + gmail connection.created / deleted.
 *   4. HMAC helper — basic correctness.
 */

import { createHash, createHmac } from 'node:crypto';

import { type CalendarProvider } from '@homehub/providers-calendar';
import { type EmailProvider } from '@homehub/providers-email';
import { type Logger, type QueueClient, queueNames } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GCAL_CHANNEL_KIND,
  GCAL_PROVIDER,
  GMAIL_HISTORY_ID_KIND,
  GMAIL_PROVIDER,
  GMAIL_WATCH_KIND,
  INSTACART_PROVIDER,
  YNAB_PROVIDER,
  handleGoogleCalendarWebhook,
  handleGoogleMailPubsubWebhook,
  handleNangoWebhook,
  type WebhookIngestDeps,
} from './handler.js';
import { verifyHmac, verifyNangoLegacySignature } from './hmac.js';

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

function makeCalendar(): CalendarProvider {
  return {
    listEvents: vi.fn(),
    watch: vi.fn().mockResolvedValue({
      channelId: 'hh-gcal-xyz',
      resourceId: 'res-1',
      expiration: '2026-04-27T00:00:00.000Z',
    }),
    unwatch: vi.fn().mockResolvedValue(undefined),
  } as unknown as CalendarProvider;
}

function makeEmail(): EmailProvider {
  return {
    listRecentMessages: vi.fn(),
    fetchMessage: vi.fn(),
    fetchFullBody: vi.fn().mockResolvedValue({ bodyText: '' }),
    fetchAttachment: vi.fn(),
    watch: vi.fn().mockResolvedValue({
      historyId: '5555',
      expiration: '2026-04-27T00:00:00.000Z',
    }),
    unwatch: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    ensureLabel: vi.fn().mockResolvedValue({ labelId: 'Label_Ingested' }),
  } as unknown as EmailProvider;
}

function makeQueues() {
  const sends: Array<{ queue: string; payload: unknown }> = [];
  const queues: QueueClient = {
    send: vi.fn(async (queue, payload) => {
      sends.push({ queue, payload });
      return 1;
    }),
    sendBatch: vi.fn(async (_queue: string, payloads: unknown[]) =>
      payloads.map((_p: unknown, i: number) => i + 1),
    ),
    claim: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    deadLetter: vi.fn(),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;
  return { queues, sends };
}

interface ConnectionRow {
  id: string;
  household_id: string;
  status: string;
  [k: string]: unknown;
}

interface CursorRow {
  connection_id: string;
  kind: string;
  value: string | null;
}

function makeSupabase(seed: {
  connections?: ConnectionRow[];
  cursors?: CursorRow[];
  upsertConnectionReturns?: { id: string; household_id: string; nango_connection_id: string };
}) {
  const cursorUpserts: Array<Record<string, unknown>> = [];
  const connectionUpserts: Array<Record<string, unknown>> = [];
  const connectionUpdates: Array<Record<string, unknown>> = [];
  const auditInserts: Array<Record<string, unknown>> = [];

  const state = { connections: [...(seed.connections ?? [])], cursors: [...(seed.cursors ?? [])] };

  const schemaSync = {
    from(table: string): unknown {
      if (table === 'provider_connection') {
        const filters: Record<string, unknown> = {};
        const builder = {
          select() {
            return builder;
          },
          eq(col: string, val: unknown) {
            filters[col] = val;
            return builder;
          },
          maybeSingle: async () => {
            const hit = state.connections.find((c) => {
              for (const [k, v] of Object.entries(filters)) {
                if ((c as unknown as Record<string, unknown>)[k] !== v) return false;
              }
              return true;
            });
            return { data: hit ?? null, error: null };
          },
          upsert(payload: Record<string, unknown>) {
            connectionUpserts.push(payload);
            return {
              select() {
                return {
                  maybeSingle: async () => ({
                    data: seed.upsertConnectionReturns ?? null,
                    error: null,
                  }),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            connectionUpdates.push(payload);
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          },
        };
        return builder;
      }
      if (table === 'cursor') {
        const filters: Record<string, unknown> = {};
        const builder = {
          select() {
            return builder;
          },
          eq(col: string, val: unknown) {
            filters[col] = val;
            return builder;
          },
          maybeSingle: async () => {
            const hit = state.cursors.find((c) => {
              for (const [k, v] of Object.entries(filters)) {
                if ((c as unknown as Record<string, unknown>)[k] !== v) return false;
              }
              return true;
            });
            return { data: hit ?? null, error: null };
          },
          then(resolve: (v: unknown) => void) {
            const rows = state.cursors.filter((c) => {
              for (const [k, v] of Object.entries(filters)) {
                if ((c as unknown as Record<string, unknown>)[k] !== v) return false;
              }
              return true;
            });
            resolve({ data: rows, error: null });
            return undefined;
          },
          upsert(payload: Record<string, unknown>) {
            cursorUpserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
          delete() {
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          },
        };
        return builder;
      }
      throw new Error(`unexpected sync.${table}`);
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

  const supabase = {
    schema(name: string) {
      if (name === 'sync') return schemaSync;
      if (name === 'audit') return schemaAudit;
      throw new Error(`unexpected schema ${name}`);
    },
  };

  return { supabase, cursorUpserts, connectionUpserts, connectionUpdates, auditInserts };
}

const CONNECTION_ID = 'c0000000-0000-4000-8000-000000000001';
const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';

function baseDeps(): WebhookIngestDeps {
  return {
    supabase: {} as never,
    queues: {} as never,
    calendar: makeCalendar(),
    email: makeEmail(),
    log: makeLog(),
    env: {},
    now: () => new Date('2026-04-20T12:00:00.000Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- verifyHmac ---------------------------------------------------------

describe('verifyHmac', () => {
  it('returns true on a matching signature', () => {
    const body = Buffer.from('{"a":1}');
    const secret = 'secret';
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmac({ rawBody: body, signature: sig, secret })).toBe(true);
  });
  it('returns false on mismatch', () => {
    expect(verifyHmac({ rawBody: Buffer.from('x'), signature: 'deadbeef', secret: 'secret' })).toBe(
      false,
    );
  });
});

describe('verifyNangoLegacySignature', () => {
  it('returns true for Nango 0.70 legacy signatures', () => {
    const payload = { type: 'connection.created', connectionId: 'nango-1' };
    const secret = 'secret';
    const signature = createHash('sha256')
      .update(`${secret}${JSON.stringify(payload)}`)
      .digest('hex');
    expect(verifyNangoLegacySignature({ payload, signature, secret })).toBe(true);
  });

  it('returns false on mismatch', () => {
    expect(
      verifyNangoLegacySignature({
        payload: { type: 'connection.created' },
        signature: 'deadbeef',
        secret: 'secret',
      }),
    ).toBe(false);
  });
});

// --- /webhooks/google-calendar -----------------------------------------

describe('handleGoogleCalendarWebhook', () => {
  it('returns 400 when required headers are missing', async () => {
    const { supabase } = makeSupabase({});
    const { queues } = makeQueues();
    const result = await handleGoogleCalendarWebhook(
      { ...baseDeps(), supabase: supabase as never, queues },
      { headers: {} },
    );
    expect(result.status).toBe(400);
  });

  it('returns 204 without enqueue for resource-state=sync', async () => {
    const { supabase } = makeSupabase({});
    const { queues, sends } = makeQueues();
    const result = await handleGoogleCalendarWebhook(
      { ...baseDeps(), supabase: supabase as never, queues },
      {
        headers: {
          'x-goog-channel-id': 'hh-gcal-1',
          'x-goog-resource-id': 'res-1',
          'x-goog-resource-state': 'sync',
        },
      },
    );
    expect(result.status).toBe(204);
    expect(sends).toEqual([]);
  });

  it('returns 404 on unknown channel', async () => {
    const { supabase } = makeSupabase({ cursors: [] });
    const { queues } = makeQueues();
    const result = await handleGoogleCalendarWebhook(
      { ...baseDeps(), supabase: supabase as never, queues },
      {
        headers: {
          'x-goog-channel-id': 'hh-gcal-unknown',
          'x-goog-resource-id': 'res-1',
          'x-goog-resource-state': 'exists',
        },
      },
    );
    expect(result.status).toBe(404);
  });

  it('enqueues sync_delta on valid channel and returns 204', async () => {
    const cursorValue = JSON.stringify({
      channel_id: 'hh-gcal-abc',
      resource_id: 'res-abc',
      expiration: '2026-04-27T00:00:00Z',
    });
    const { supabase } = makeSupabase({
      connections: [{ id: CONNECTION_ID, household_id: HOUSEHOLD_ID, status: 'active' }],
      cursors: [{ connection_id: CONNECTION_ID, kind: GCAL_CHANNEL_KIND, value: cursorValue }],
    });
    const { queues, sends } = makeQueues();
    const result = await handleGoogleCalendarWebhook(
      { ...baseDeps(), supabase: supabase as never, queues },
      {
        headers: {
          'x-goog-channel-id': 'hh-gcal-abc',
          'x-goog-resource-id': 'res-abc',
          'x-goog-resource-state': 'exists',
        },
      },
    );
    expect(result.status).toBe(204);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.queue).toBe(queueNames.syncDelta(GCAL_PROVIDER));
    expect(sends[0]?.payload).toMatchObject({
      household_id: HOUSEHOLD_ID,
      entity_id: CONNECTION_ID,
      kind: 'sync.gcal.delta',
    });
  });
});

// --- /webhooks/google-mail/pubsub --------------------------------------

describe('handleGoogleMailPubsubWebhook', () => {
  function pubsubBody(emailAddress: string, historyId: string | number): Buffer {
    const data = Buffer.from(JSON.stringify({ emailAddress, historyId })).toString('base64');
    return Buffer.from(JSON.stringify({ message: { data, messageId: 'm-1' } }));
  }

  it('returns 503 when neither token nor audience is configured', async () => {
    const { supabase } = makeSupabase({});
    const { queues } = makeQueues();
    const res = await handleGoogleMailPubsubWebhook(
      { ...baseDeps(), supabase: supabase as never, queues, env: {} },
      { headers: {}, rawBody: pubsubBody('a@x', 1), query: {} },
    );
    expect(res.status).toBe(503);
  });

  it('returns 401 when the token query param is missing or wrong', async () => {
    const { supabase } = makeSupabase({});
    const { queues } = makeQueues();
    const deps = {
      ...baseDeps(),
      supabase: supabase as never,
      queues,
      env: { HOMEHUB_GMAIL_WEBHOOK_TOKEN: 'shhh' },
    };
    const miss = await handleGoogleMailPubsubWebhook(deps, {
      headers: {},
      rawBody: pubsubBody('a@x', 1),
      query: {},
    });
    expect(miss.status).toBe(401);
    const wrong = await handleGoogleMailPubsubWebhook(deps, {
      headers: {},
      rawBody: pubsubBody('a@x', 1),
      query: { token: 'nope' },
    });
    expect(wrong.status).toBe(401);
  });

  it('returns 404 when no connection matches the emailAddress', async () => {
    const { supabase } = makeSupabase({ connections: [] });
    const { queues, sends } = makeQueues();
    const res = await handleGoogleMailPubsubWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { HOMEHUB_GMAIL_WEBHOOK_TOKEN: 'shhh' },
      },
      { headers: {}, rawBody: pubsubBody('missing@example.com', 1), query: { token: 'shhh' } },
    );
    expect(res.status).toBe(404);
    expect(sends).toEqual([]);
  });

  it('enqueues sync_delta:gmail when the account is known', async () => {
    const { supabase } = makeSupabase({
      connections: [
        {
          id: CONNECTION_ID,
          household_id: HOUSEHOLD_ID,
          status: 'active',
          provider: GMAIL_PROVIDER,

          'metadata->>email_address': 'alice@example.com',
        },
      ],
    });
    const { queues, sends } = makeQueues();
    const res = await handleGoogleMailPubsubWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { HOMEHUB_GMAIL_WEBHOOK_TOKEN: 'shhh' },
      },
      {
        headers: {},
        rawBody: pubsubBody('alice@example.com', 9001),
        query: { token: 'shhh' },
      },
    );
    expect(res.status).toBe(204);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.queue).toBe(queueNames.syncDelta(GMAIL_PROVIDER));
    expect(sends[0]?.payload).toMatchObject({
      household_id: HOUSEHOLD_ID,
      entity_id: CONNECTION_ID,
      kind: 'sync.gmail.delta',
    });
  });

  it('honors revoked connections (204 without enqueue)', async () => {
    const { supabase } = makeSupabase({
      connections: [
        {
          id: CONNECTION_ID,
          household_id: HOUSEHOLD_ID,
          status: 'revoked',
          provider: GMAIL_PROVIDER,

          'metadata->>email_address': 'alice@example.com',
        },
      ],
    });
    const { queues, sends } = makeQueues();
    const res = await handleGoogleMailPubsubWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { HOMEHUB_GMAIL_WEBHOOK_TOKEN: 'shhh' },
      },
      {
        headers: {},
        rawBody: pubsubBody('alice@example.com', 9001),
        query: { token: 'shhh' },
      },
    );
    expect(res.status).toBe(204);
    expect(sends).toEqual([]);
  });
});

// --- /webhooks/nango ----------------------------------------------------

describe('handleNangoWebhook — gcal', () => {
  const SECRET = 'nango-secret';

  function signed(body: unknown): { rawBody: Buffer; headers: Record<string, string> } {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
    return { rawBody, headers: { 'x-nango-hmac-sha256': signature } };
  }

  function legacySigned(body: unknown): { rawBody: Buffer; headers: Record<string, string> } {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHash('sha256')
      .update(`${SECRET}${JSON.stringify(body)}`)
      .digest('hex');
    return { rawBody, headers: { 'x-nango-signature': signature } };
  }

  it('returns 400 when signature header is missing', async () => {
    const { supabase } = makeSupabase({});
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      { ...baseDeps(), supabase: supabase as never, queues, env: { NANGO_WEBHOOK_SECRET: SECRET } },
      { headers: {}, rawBody: Buffer.from('{}') },
    );
    expect(res.status).toBe(400);
  });

  it('returns 401 on bad signature', async () => {
    const { supabase } = makeSupabase({});
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      { ...baseDeps(), supabase: supabase as never, queues, env: { NANGO_WEBHOOK_SECRET: SECRET } },
      {
        headers: { 'x-nango-hmac-sha256': 'wrong' },
        rawBody: Buffer.from('{}'),
      },
    );
    expect(res.status).toBe(401);
  });

  it('on connection.created: upserts connection, enqueues full sync, attempts watch', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'google-calendar',
      connectionId: 'nango-1',
      endUser: { tags: { household_id: HOUSEHOLD_ID, member_id: 'm1' } },
    };
    const { rawBody, headers } = signed(payload);
    const { supabase, cursorUpserts, connectionUpserts } = makeSupabase({
      upsertConnectionReturns: {
        id: CONNECTION_ID,
        household_id: HOUSEHOLD_ID,
        nango_connection_id: 'nango-1',
      },
    });
    const { queues, sends } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET, WEBHOOK_PUBLIC_URL: 'https://hh.example.com' },
        channelIdFactory: () => 'hh-gcal-fixed',
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(204);
    expect(connectionUpserts).toHaveLength(1);
    expect(connectionUpserts[0]).toMatchObject({
      provider: GCAL_PROVIDER,
      nango_connection_id: 'nango-1',
      status: 'active',
    });
    expect(cursorUpserts).toHaveLength(1);
    expect(cursorUpserts[0]?.kind).toBe(GCAL_CHANNEL_KIND);
    expect(sends[0]?.queue).toBe(queueNames.syncFull(GCAL_PROVIDER));
  });

  it('accepts the legacy X-Nango-Signature format', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'google-calendar',
      connectionId: 'nango-legacy',
      endUser: { tags: { household_id: HOUSEHOLD_ID } },
    };
    const { rawBody, headers } = legacySigned(payload);
    const { supabase } = makeSupabase({
      upsertConnectionReturns: {
        id: CONNECTION_ID,
        household_id: HOUSEHOLD_ID,
        nango_connection_id: 'nango-legacy',
      },
    });
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(204);
  });
});

describe('handleNangoWebhook — gmail', () => {
  const SECRET = 'nango-secret';

  function signed(body: unknown): { rawBody: Buffer; headers: Record<string, string> } {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
    return { rawBody, headers: { 'x-nango-hmac-sha256': signature } };
  }

  it('on connection.created: upserts with email_categories metadata, watches, enqueues full', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'google-mail',
      connectionId: 'nango-gm-1',
      endUser: {
        tags: {
          household_id: HOUSEHOLD_ID,
          member_id: 'm1',
          email_categories: 'receipt,shipping,bogus',
          email_address: 'alice@example.com',
        },
      },
    };
    const { rawBody, headers } = signed(payload);
    const { supabase, cursorUpserts, connectionUpserts } = makeSupabase({
      upsertConnectionReturns: {
        id: CONNECTION_ID,
        household_id: HOUSEHOLD_ID,
        nango_connection_id: 'nango-gm-1',
      },
    });
    const { queues, sends } = makeQueues();
    const email = makeEmail();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        email,
        env: {
          NANGO_WEBHOOK_SECRET: SECRET,
          NANGO_GMAIL_PUBSUB_TOPIC: 'projects/p/topics/gmail-push',
        },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(204);
    expect(connectionUpserts).toHaveLength(1);
    expect(connectionUpserts[0]).toMatchObject({
      provider: GMAIL_PROVIDER,
      nango_connection_id: 'nango-gm-1',
      status: 'active',
    });
    // 'bogus' category dropped.
    expect(connectionUpserts[0]?.metadata).toEqual({
      email_categories: ['receipt', 'shipping'],
      email_address: 'alice@example.com',
    });
    // Both watch + history_id cursors seeded.
    const kinds = cursorUpserts.map((c) => c.kind).sort();
    expect(kinds).toEqual([GMAIL_HISTORY_ID_KIND, GMAIL_WATCH_KIND].sort());
    expect(sends[0]?.queue).toBe(queueNames.syncFull(GMAIL_PROVIDER));
    expect(email.watch).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'nango-gm-1',
        topicName: 'projects/p/topics/gmail-push',
      }),
    );
    expect(email.ensureLabel).toHaveBeenCalledTimes(1);
  });

  it('on connection.created: skips watch when topic is not configured', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'google-mail',
      connectionId: 'nango-gm-2',
      endUser: {
        tags: { household_id: HOUSEHOLD_ID, email_categories: 'receipt' },
      },
    };
    const { rawBody, headers } = signed(payload);
    const { supabase, cursorUpserts } = makeSupabase({
      upsertConnectionReturns: {
        id: CONNECTION_ID,
        household_id: HOUSEHOLD_ID,
        nango_connection_id: 'nango-gm-2',
      },
    });
    const { queues } = makeQueues();
    const email = makeEmail();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        email,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(204);
    expect(cursorUpserts).toHaveLength(0);
    expect(email.watch).not.toHaveBeenCalled();
  });

  it('on connection.deleted: marks revoked and unwatches', async () => {
    const payload = {
      type: 'connection.deleted',
      providerConfigKey: 'google-mail',
      connectionId: 'nango-gm-del',
    };
    const { rawBody, headers } = signed(payload);
    const seeded = makeSupabase({
      connections: [
        {
          id: CONNECTION_ID,
          household_id: HOUSEHOLD_ID,
          status: 'active',
          provider: GMAIL_PROVIDER,
          nango_connection_id: 'nango-gm-del',
        } as unknown as ConnectionRow,
      ],
    });
    const email = makeEmail();
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: seeded.supabase as never,
        queues,
        email,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(204);
    expect(email.unwatch).toHaveBeenCalledWith({ connectionId: 'nango-gm-del' });
    expect(seeded.connectionUpdates[0]).toMatchObject({ status: 'revoked' });
  });

  it('on connection.created: rejects when household_id tag missing', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'google-mail',
      connectionId: 'nango-bad',
      endUser: { tags: {} },
    };
    const { rawBody, headers } = signed(payload);
    const { supabase } = makeSupabase({});
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(400);
  });
});

describe('handleNangoWebhook — ynab', () => {
  const SECRET = 'nango-secret';

  function signed(body: unknown): { rawBody: Buffer; headers: Record<string, string> } {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
    return { rawBody, headers: { 'x-nango-hmac-sha256': signature } };
  }

  it('on connection.created: upserts connection and enqueues sync_full:ynab', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'ynab',
      connectionId: 'nango-ynab-1',
      endUser: { tags: { household_id: HOUSEHOLD_ID, member_id: 'm1' } },
    };
    const { rawBody, headers } = signed(payload);
    const { supabase, connectionUpserts, auditInserts } = makeSupabase({
      upsertConnectionReturns: {
        id: CONNECTION_ID,
        household_id: HOUSEHOLD_ID,
        nango_connection_id: 'nango-ynab-1',
      },
    });
    const { queues, sends } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(204);
    expect(connectionUpserts).toHaveLength(1);
    expect(connectionUpserts[0]).toMatchObject({
      provider: YNAB_PROVIDER,
      nango_connection_id: 'nango-ynab-1',
      status: 'active',
    });
    expect(sends).toHaveLength(1);
    expect(sends[0]?.queue).toBe(queueNames.syncFull(YNAB_PROVIDER));
    expect(sends[0]?.payload).toMatchObject({
      kind: 'sync.ynab.full',
      entity_id: CONNECTION_ID,
      household_id: HOUSEHOLD_ID,
    });
    expect(auditInserts[0]).toMatchObject({ action: 'sync.ynab.connection.created' });
  });

  it('on connection.created: rejects when household_id missing', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'ynab',
      connectionId: 'nango-ynab-bad',
      endUser: { tags: {} },
    };
    const { rawBody, headers } = signed(payload);
    const { supabase } = makeSupabase({});
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(400);
  });

  it('on connection.deleted: marks revoked', async () => {
    const payload = {
      type: 'connection.deleted',
      providerConfigKey: 'ynab',
      connectionId: 'nango-ynab-del',
    };
    const { rawBody, headers } = signed(payload);
    const seeded = makeSupabase({
      connections: [
        {
          id: CONNECTION_ID,
          household_id: HOUSEHOLD_ID,
          status: 'active',
          provider: YNAB_PROVIDER,
          nango_connection_id: 'nango-ynab-del',
        } as unknown as ConnectionRow,
      ],
    });
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: seeded.supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(204);
    expect(seeded.connectionUpdates[0]).toMatchObject({ status: 'revoked' });
  });
});

describe('handleNangoWebhook — instacart', () => {
  const SECRET = 'nango-secret';

  function signed(body: unknown): { rawBody: Buffer; headers: Record<string, string> } {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
    return { rawBody, headers: { 'x-nango-hmac-sha256': signature } };
  }

  it('on connection.created: upserts connection and enqueues sync_full:instacart', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'instacart',
      connectionId: 'nango-instacart-1',
      endUser: {
        tags: {
          household_id: HOUSEHOLD_ID,
          member_id: 'm1',
          instacart_store_id: 'store-1',
        },
      },
    };
    const { rawBody, headers } = signed(payload);
    const { supabase, connectionUpserts, auditInserts } = makeSupabase({
      upsertConnectionReturns: {
        id: CONNECTION_ID,
        household_id: HOUSEHOLD_ID,
        nango_connection_id: 'nango-instacart-1',
      },
    });
    const { queues, sends } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );

    expect(res.status).toBe(204);
    expect(connectionUpserts).toHaveLength(1);
    expect(connectionUpserts[0]).toMatchObject({
      provider: INSTACART_PROVIDER,
      nango_connection_id: 'nango-instacart-1',
      status: 'active',
      metadata: { instacart_store_id: 'store-1' },
    });
    expect(sends[0]?.queue).toBe(queueNames.syncFull(INSTACART_PROVIDER));
    expect(sends[0]?.payload).toMatchObject({
      kind: 'sync.instacart.full',
      entity_id: CONNECTION_ID,
      household_id: HOUSEHOLD_ID,
    });
    expect(auditInserts[0]).toMatchObject({
      action: 'sync.instacart.connection.created',
    });
  });

  it('on connection.created: rejects when household_id missing', async () => {
    const payload = {
      type: 'connection.created',
      providerConfigKey: 'instacart',
      connectionId: 'nango-instacart-bad',
      endUser: { tags: {} },
    };
    const { rawBody, headers } = signed(payload);
    const { supabase } = makeSupabase({});
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(400);
  });

  it('on connection.deleted: marks revoked', async () => {
    const payload = {
      type: 'connection.deleted',
      providerConfigKey: 'instacart',
      connectionId: 'nango-instacart-del',
    };
    const { rawBody, headers } = signed(payload);
    const seeded = makeSupabase({
      connections: [
        {
          id: CONNECTION_ID,
          household_id: HOUSEHOLD_ID,
          status: 'active',
          provider: INSTACART_PROVIDER,
          nango_connection_id: 'nango-instacart-del',
        } as unknown as ConnectionRow,
      ],
    });
    const { queues } = makeQueues();
    const res = await handleNangoWebhook(
      {
        ...baseDeps(),
        supabase: seeded.supabase as never,
        queues,
        env: { NANGO_WEBHOOK_SECRET: SECRET },
      },
      { headers, rawBody },
    );
    expect(res.status).toBe(204);
    expect(seeded.connectionUpdates[0]).toMatchObject({ status: 'revoked' });
  });
});
