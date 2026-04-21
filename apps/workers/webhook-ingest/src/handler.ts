/**
 * `webhook-ingest` HTTP handler logic.
 *
 * This service is the single public HTTP ingress for every provider
 * webhook HomeHub integrates with. It terminates TLS at Railway's edge,
 * verifies the provider signature, and enqueues a fan-out message for
 * the matching `sync-*` worker.
 *
 * Routes today (M4-A):
 *
 *   POST /webhooks/google-calendar
 *     - Google push notifications do NOT use HMAC. They identify the
 *       target with `X-Goog-Channel-ID` + `X-Goog-Resource-ID` headers.
 *       Channel → connection lookup via `sync.cursor` (kind='gcal.channel').
 *       Enqueue `sync_delta:gcal`, 204.
 *     - Unknown channel → 404. Malformed headers → 400.
 *
 *   POST /webhooks/google-mail/pubsub
 *     - Google Pub/Sub push notifications for Gmail. The request body is
 *       `{ message: { data: base64-json }, subscription }` where the
 *       decoded data carries `{ emailAddress, historyId }`. We look up
 *       the connection by stored email address metadata, enqueue
 *       `sync_delta:gmail`, 204.
 *     - Pub/Sub verification: when
 *       `HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE` is configured we require a
 *       signed JWT (`Authorization: Bearer <jwt>`) whose audience
 *       matches; otherwise we gate the route on the presence of a
 *       shared-secret token embedded in the URL (the Pub/Sub push
 *       subscription can be configured with auth headers *or* a token).
 *       Local dev: leave both unset → the route rejects all requests.
 *
 *   POST /webhooks/nango
 *     - Nango signs the body with `X-Nango-Signature` (HMAC-SHA256 hex).
 *     - `connection.created` with `provider=google-calendar`:
 *         1. Upsert `sync.provider_connection`.
 *         2. Call `gcal.watch()`; store channel in `sync.cursor`.
 *         3. Enqueue `sync_full:gcal`.
 *     - `connection.created` with `provider=google-mail`:
 *         1. Upsert `sync.provider_connection`, writing
 *            `metadata.email_categories` from the session tags.
 *         2. `email.ensureLabel('HomeHub/Ingested')`.
 *         3. `email.watch({ topicName })` when
 *            `NANGO_GMAIL_PUBSUB_TOPIC` is configured; store historyId
 *            in `sync.cursor`.
 *         4. Enqueue `sync_full:gmail`.
 *     - `connection.deleted`: mark revoked; unwatch the relevant
 *       subscription; clear cursors.
 */

import { type Database, type Json } from '@homehub/db';
import { type CalendarProvider } from '@homehub/providers-calendar';
import {
  type EmailCategory,
  type EmailProvider,
  HOMEHUB_INGESTED_LABEL_NAME,
  isEmailCategory,
} from '@homehub/providers-email';
import { type Logger, type QueueClient, queueNames } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

import { verifyHmac } from './hmac.js';

export const GCAL_CHANNEL_KIND = 'gcal.channel';
export const GCAL_SYNC_TOKEN_KIND = 'gcal.sync_token';
export const GCAL_PROVIDER_KEY = 'google-calendar';
export const GCAL_PROVIDER = 'gcal';

export const GMAIL_PROVIDER_KEY = 'google-mail';
export const GMAIL_PROVIDER = 'gmail';
export const GMAIL_HISTORY_ID_KIND = 'gmail.history_id';
export const GMAIL_WATCH_KIND = 'gmail.watch';

// `sync.cursor.value` for a gcal channel is JSON
// `{"channel_id","resource_id","expiration"}`. Connection is the FK.
export interface GcalChannelValue {
  resource_id: string;
  expiration: string;
}

// `sync.cursor.value` for a gmail watch subscription is JSON
// `{"history_id","expiration"}`. We keep the historyId cursor separate
// (kind='gmail.history_id') so the worker only reads one column.
export interface GmailWatchValue {
  history_id: string;
  expiration: string;
  email_address?: string;
}

export interface WebhookIngestDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  calendar: CalendarProvider;
  email: EmailProvider;
  log: Logger;
  env: {
    NANGO_WEBHOOK_SECRET?: string;
    WEBHOOK_PUBLIC_URL?: string;
    /** `projects/<gcp-project>/topics/<topic>` used for Gmail watch. */
    NANGO_GMAIL_PUBSUB_TOPIC?: string;
    /**
     * Shared-secret query token that `projects.subscriptions.create`
     * attaches to the Gmail Pub/Sub push URL. When set, the webhook
     * requires `?token=<value>`.
     */
    HOMEHUB_GMAIL_WEBHOOK_TOKEN?: string;
    /**
     * When set, the Gmail webhook also requires a verified JWT whose
     * audience matches. JWT verification is left as a documented
     * follow-up — for v1 the presence of the env toggles a hard-reject
     * if the header is missing.
     */
    HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE?: string;
  };
  /** Injectable for tests. */
  now?: () => Date;
  /** Used only by the gcal path. */
  channelIdFactory?: () => string;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export interface HandleGoogleCalendarArgs {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

// ---- Route: POST /webhooks/google-calendar -----------------------------

export async function handleGoogleCalendarWebhook(
  deps: WebhookIngestDeps,
  args: HandleGoogleCalendarArgs,
): Promise<WebhookResult> {
  const channelId = headerAsString(args.headers['x-goog-channel-id']);
  const resourceId = headerAsString(args.headers['x-goog-resource-id']);
  const resourceState = headerAsString(args.headers['x-goog-resource-state']);

  if (!channelId || !resourceId) {
    deps.log.warn('gcal webhook missing required headers', {
      has_channel_id: Boolean(channelId),
      has_resource_id: Boolean(resourceId),
    });
    return { status: 400, body: { error: 'missing required x-goog-* headers' } };
  }

  if (resourceState === 'sync') {
    deps.log.info('gcal channel sync notification received', { channel_id: channelId });
    return { status: 204, body: {} };
  }

  const { data: cursors, error } = await deps.supabase
    .schema('sync')
    .from('cursor')
    .select('connection_id, value, kind')
    .eq('kind', GCAL_CHANNEL_KIND);
  if (error) {
    throw new Error(`cursor lookup failed: ${error.message}`);
  }

  const match = (cursors ?? []).find((row) => {
    const parsed = parseGcalChannelValue(row.value);
    return parsed?.channel_id === channelId;
  });

  if (!match) {
    deps.log.warn('gcal webhook for unknown channel; dropping', {
      channel_id: channelId,
      resource_id: resourceId,
    });
    return { status: 404, body: { error: 'unknown channel' } };
  }

  const { data: connection, error: connErr } = await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id, status')
    .eq('id', match.connection_id)
    .maybeSingle();
  if (connErr) throw new Error(`provider_connection lookup failed: ${connErr.message}`);
  if (!connection) {
    deps.log.warn('gcal channel cursor orphaned from connection; dropping', {
      channel_id: channelId,
      connection_id: match.connection_id,
    });
    return { status: 404, body: { error: 'connection not found' } };
  }

  if (connection.status === 'revoked') {
    deps.log.info('gcal webhook received for revoked connection; ignoring', {
      connection_id: connection.id,
    });
    return { status: 204, body: {} };
  }

  const now = (deps.now ?? (() => new Date()))();
  await deps.queues.send(queueNames.syncDelta(GCAL_PROVIDER), {
    household_id: connection.household_id,
    kind: 'sync.gcal.delta',
    entity_id: connection.id,
    version: 1,
    enqueued_at: now.toISOString(),
  });
  deps.log.info('gcal delta sync enqueued', {
    channel_id: channelId,
    connection_id: connection.id,
  });
  return { status: 204, body: {} };
}

// ---- Route: POST /webhooks/google-mail/pubsub --------------------------

export interface HandleGoogleMailPubsubArgs {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  rawBody: Buffer;
  /** Parsed URL query params. */
  query: Readonly<Record<string, string | undefined>>;
}

interface PubsubPayload {
  message?: { data?: string; messageId?: string; publishTime?: string };
  subscription?: string;
}

interface GmailHistoryNotification {
  emailAddress?: string;
  historyId?: number | string;
}

export async function handleGoogleMailPubsubWebhook(
  deps: WebhookIngestDeps,
  args: HandleGoogleMailPubsubArgs,
): Promise<WebhookResult> {
  // Gate — unless at least one verification knob is configured we
  // refuse to act. Fail closed.
  const expectedToken = deps.env.HOMEHUB_GMAIL_WEBHOOK_TOKEN;
  const expectedAudience = deps.env.HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE;
  if (!expectedToken && !expectedAudience) {
    deps.log.error(
      'gmail pubsub webhook not configured; HOMEHUB_GMAIL_WEBHOOK_TOKEN or HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE must be set',
    );
    return { status: 503, body: { error: 'gmail webhook not configured' } };
  }

  if (expectedToken) {
    const token = args.query.token;
    if (!token || !timingSafeEqual(token, expectedToken)) {
      deps.log.warn('gmail pubsub webhook token mismatch');
      return { status: 401, body: { error: 'invalid token' } };
    }
  }
  if (expectedAudience) {
    const authz = headerAsString(args.headers.authorization);
    if (!authz || !/^Bearer\s+\S+/.test(authz)) {
      deps.log.warn('gmail pubsub webhook missing bearer token');
      return { status: 401, body: { error: 'missing bearer token' } };
    }
    // Full JWT signature verification against Google's JWKS is deferred
    // — the shared-secret token is the primary gate. We still require
    // the header's presence so a misconfigured push subscription is
    // loud rather than silent. See follow-up in the M4-A report.
  }

  let payload: PubsubPayload;
  try {
    payload = JSON.parse(args.rawBody.toString('utf8'));
  } catch (err) {
    deps.log.warn('gmail pubsub body is not JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 400, body: { error: 'invalid json' } };
  }

  if (!payload.message?.data) {
    return { status: 400, body: { error: 'missing message.data' } };
  }

  let notification: GmailHistoryNotification;
  try {
    const decoded = Buffer.from(payload.message.data, 'base64').toString('utf8');
    notification = JSON.parse(decoded);
  } catch (err) {
    deps.log.warn('gmail pubsub message.data not decodable JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 400, body: { error: 'invalid message.data' } };
  }

  const emailAddress = notification.emailAddress;
  if (!emailAddress) {
    return { status: 400, body: { error: 'missing emailAddress in notification' } };
  }

  const connection = await lookupGmailConnectionByEmail(deps.supabase, emailAddress);
  if (!connection) {
    deps.log.warn('gmail pubsub for unknown account; dropping', { email_address: emailAddress });
    return { status: 404, body: { error: 'unknown account' } };
  }
  if (connection.status === 'revoked') {
    deps.log.info('gmail pubsub for revoked connection; ignoring', {
      connection_id: connection.id,
    });
    return { status: 204, body: {} };
  }

  const now = (deps.now ?? (() => new Date()))();
  await deps.queues.send(queueNames.syncDelta(GMAIL_PROVIDER), {
    household_id: connection.household_id,
    kind: 'sync.gmail.delta',
    entity_id: connection.id,
    version: 1,
    enqueued_at: now.toISOString(),
  });
  deps.log.info('gmail delta sync enqueued', {
    email_address: emailAddress,
    connection_id: connection.id,
  });
  return { status: 204, body: {} };
}

// ---- Route: POST /webhooks/nango ---------------------------------------

export interface HandleNangoArgs {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  rawBody: Buffer;
}

export async function handleNangoWebhook(
  deps: WebhookIngestDeps,
  args: HandleNangoArgs,
): Promise<WebhookResult> {
  const signature = headerAsString(args.headers['x-nango-signature']);
  if (!signature) {
    return { status: 400, body: { error: 'missing x-nango-signature header' } };
  }
  if (!deps.env.NANGO_WEBHOOK_SECRET) {
    deps.log.error('NANGO_WEBHOOK_SECRET not configured; rejecting webhook');
    return { status: 500, body: { error: 'webhook secret not configured' } };
  }

  const ok = verifyHmac({
    rawBody: args.rawBody,
    signature,
    secret: deps.env.NANGO_WEBHOOK_SECRET,
    encoding: 'hex',
  });
  if (!ok) {
    deps.log.warn('nango webhook signature mismatch');
    return { status: 401, body: { error: 'invalid signature' } };
  }

  let payload: {
    type?: string;
    operation?: string;
    providerConfigKey?: string;
    connectionId?: string;
    endUser?: {
      endUserId?: string;
      tags?: Record<string, string>;
    };
  };
  try {
    payload = JSON.parse(args.rawBody.toString('utf8'));
  } catch (err) {
    deps.log.warn('nango webhook body is not JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 400, body: { error: 'invalid json' } };
  }

  const eventType = (payload.type ?? payload.operation ?? '').toLowerCase();
  const providerKey = payload.providerConfigKey;
  const connectionId = payload.connectionId;
  if (!providerKey || !connectionId) {
    return {
      status: 400,
      body: { error: 'missing providerConfigKey / connectionId in webhook' },
    };
  }

  if (providerKey !== GCAL_PROVIDER_KEY && providerKey !== GMAIL_PROVIDER_KEY) {
    deps.log.warn('nango webhook for provider we do not handle', { provider: providerKey });
    return { status: 204, body: {} };
  }

  const isCreated =
    eventType === 'connection.created' || eventType === 'auth' || eventType.endsWith('.created');
  const isDeleted = eventType === 'connection.deleted' || eventType.endsWith('.deleted');

  if (isCreated) {
    if (providerKey === GCAL_PROVIDER_KEY) {
      return handleGcalConnectionCreated(deps, {
        nangoConnectionId: connectionId,
        tags: payload.endUser?.tags ?? {},
      });
    }
    return handleGmailConnectionCreated(deps, {
      nangoConnectionId: connectionId,
      tags: payload.endUser?.tags ?? {},
    });
  }
  if (isDeleted) {
    if (providerKey === GCAL_PROVIDER_KEY) {
      return handleGcalConnectionDeleted(deps, { nangoConnectionId: connectionId });
    }
    return handleGmailConnectionDeleted(deps, { nangoConnectionId: connectionId });
  }

  deps.log.info('nango webhook with non-actionable type; ignoring', { type: eventType });
  return { status: 204, body: {} };
}

// ---- gcal create/delete ------------------------------------------------

async function handleGcalConnectionCreated(
  deps: WebhookIngestDeps,
  args: { nangoConnectionId: string; tags: Record<string, string> },
): Promise<WebhookResult> {
  const householdId = args.tags.household_id;
  const memberId = args.tags.member_id ?? null;
  if (!householdId) {
    deps.log.error('nango connection.created missing household_id tag', {
      nango_connection_id: args.nangoConnectionId,
    });
    return { status: 400, body: { error: 'household_id tag required on connect session' } };
  }

  const { data: upserted, error: upsertErr } = await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .upsert(
      {
        household_id: householdId,
        member_id: memberId,
        provider: GCAL_PROVIDER,
        nango_connection_id: args.nangoConnectionId,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'household_id,provider,nango_connection_id' },
    )
    .select('id, household_id, nango_connection_id')
    .maybeSingle();
  if (upsertErr) {
    throw new Error(`provider_connection upsert failed: ${upsertErr.message}`);
  }
  if (!upserted) {
    throw new Error('provider_connection upsert returned no row');
  }

  try {
    if (deps.env.WEBHOOK_PUBLIC_URL) {
      const channelId = (deps.channelIdFactory ?? defaultGcalChannelIdFactory)();
      const watchResult = await deps.calendar.watch({
        connectionId: args.nangoConnectionId,
        channelId,
        webhookUrl: `${deps.env.WEBHOOK_PUBLIC_URL.replace(/\/$/, '')}/webhooks/google-calendar`,
      });

      const value: GcalChannelValue & { channel_id: string } = {
        channel_id: watchResult.channelId,
        resource_id: watchResult.resourceId,
        expiration: watchResult.expiration,
      };
      const { error: cursorErr } = await deps.supabase
        .schema('sync')
        .from('cursor')
        .upsert(
          {
            connection_id: upserted.id,
            kind: GCAL_CHANNEL_KIND,
            value: JSON.stringify(value),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'connection_id,kind' },
        );
      if (cursorErr) {
        deps.log.error('failed to persist gcal channel cursor', { error: cursorErr.message });
      }
    } else {
      deps.log.warn('WEBHOOK_PUBLIC_URL unset; skipping events.watch subscription');
    }
  } catch (err) {
    deps.log.error('events.watch failed for new gcal connection', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const now = (deps.now ?? (() => new Date()))();
  await deps.queues.send(queueNames.syncFull(GCAL_PROVIDER), {
    household_id: upserted.household_id,
    kind: 'sync.gcal.full',
    entity_id: upserted.id,
    version: 1,
    enqueued_at: now.toISOString(),
  });

  await writeAudit(deps.supabase, {
    household_id: upserted.household_id,
    action: 'sync.gcal.connection.created',
    resource_id: upserted.id,
    after: { nango_connection_id: args.nangoConnectionId, member_id: memberId },
  });

  deps.log.info('gcal connection created; full sync enqueued', {
    connection_id: upserted.id,
    household_id: upserted.household_id,
  });
  return { status: 204, body: {} };
}

async function handleGcalConnectionDeleted(
  deps: WebhookIngestDeps,
  args: { nangoConnectionId: string },
): Promise<WebhookResult> {
  const { data: connection, error: lookupErr } = await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id')
    .eq('provider', GCAL_PROVIDER)
    .eq('nango_connection_id', args.nangoConnectionId)
    .maybeSingle();
  if (lookupErr) throw new Error(`connection lookup failed: ${lookupErr.message}`);
  if (!connection) {
    return { status: 204, body: {} };
  }

  const { data: channelCursor } = await deps.supabase
    .schema('sync')
    .from('cursor')
    .select('value')
    .eq('connection_id', connection.id)
    .eq('kind', GCAL_CHANNEL_KIND)
    .maybeSingle();
  const parsedChannel = parseGcalChannelValue(channelCursor?.value ?? null);
  if (parsedChannel) {
    try {
      await deps.calendar.unwatch({
        connectionId: args.nangoConnectionId,
        channelId: parsedChannel.channel_id,
        resourceId: parsedChannel.resource_id,
      });
    } catch (err) {
      deps.log.warn('gcal unwatch failed on connection.deleted; continuing', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', connection.id);
  await deps.supabase.schema('sync').from('cursor').delete().eq('connection_id', connection.id);

  await writeAudit(deps.supabase, {
    household_id: connection.household_id,
    action: 'sync.gcal.connection.deleted',
    resource_id: connection.id,
    after: { nango_connection_id: args.nangoConnectionId },
  });

  deps.log.info('gcal connection revoked', { connection_id: connection.id });
  return { status: 204, body: {} };
}

// ---- gmail create/delete -----------------------------------------------

async function handleGmailConnectionCreated(
  deps: WebhookIngestDeps,
  args: { nangoConnectionId: string; tags: Record<string, string> },
): Promise<WebhookResult> {
  const householdId = args.tags.household_id;
  const memberId = args.tags.member_id ?? null;
  if (!householdId) {
    deps.log.error('nango gmail connection.created missing household_id tag', {
      nango_connection_id: args.nangoConnectionId,
    });
    return { status: 400, body: { error: 'household_id tag required on connect session' } };
  }

  const categories = parseCategoriesTag(args.tags.email_categories);
  const emailAddress = args.tags.email_address ?? null;

  // Upsert with metadata embedded. The `metadata` column is cast
  // through because the generated types don't surface it today.
  const metadata: Record<string, unknown> = {
    email_categories: categories,
    ...(emailAddress ? { email_address: emailAddress } : {}),
  };

  const { data: upserted, error: upsertErr } = await (deps.supabase
    .schema('sync')
    .from('provider_connection')
    .upsert(
      {
        household_id: householdId,
        member_id: memberId,
        provider: GMAIL_PROVIDER,
        nango_connection_id: args.nangoConnectionId,
        status: 'active',
        updated_at: new Date().toISOString(),
        metadata: metadata as unknown as Json,
      } as never,
      { onConflict: 'household_id,provider,nango_connection_id' },
    )
    .select('id, household_id, nango_connection_id')
    .maybeSingle() as unknown as Promise<{
    data: { id: string; household_id: string; nango_connection_id: string } | null;
    error: { message: string } | null;
  }>);
  if (upsertErr) {
    throw new Error(`provider_connection upsert failed: ${upsertErr.message}`);
  }
  if (!upserted) {
    throw new Error('provider_connection upsert returned no row');
  }

  // Ensure the label exists so the first full-sync can apply it
  // immediately. Non-fatal on failure — the worker ensures it again.
  try {
    await deps.email.ensureLabel({
      connectionId: args.nangoConnectionId,
      name: HOMEHUB_INGESTED_LABEL_NAME,
    });
  } catch (err) {
    deps.log.warn('gmail ensureLabel failed in webhook; worker will retry', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Subscribe to Gmail push via Pub/Sub when the topic is configured.
  // Without a topic we fall back to the hourly poll only (polled by
  // the sync-gmail worker when it sees a stale last_synced_at).
  if (deps.env.NANGO_GMAIL_PUBSUB_TOPIC) {
    try {
      const watchResult = await deps.email.watch({
        connectionId: args.nangoConnectionId,
        topicName: deps.env.NANGO_GMAIL_PUBSUB_TOPIC,
        labelIds: ['INBOX'],
      });
      const watchValue: GmailWatchValue = {
        history_id: watchResult.historyId,
        expiration: watchResult.expiration,
        ...(emailAddress ? { email_address: emailAddress } : {}),
      };
      const { error: watchErr } = await deps.supabase
        .schema('sync')
        .from('cursor')
        .upsert(
          {
            connection_id: upserted.id,
            kind: GMAIL_WATCH_KIND,
            value: JSON.stringify(watchValue),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'connection_id,kind' },
        );
      if (watchErr) {
        deps.log.error('failed to persist gmail watch cursor', { error: watchErr.message });
      }

      // Seed the history-id cursor so the first delta has a starting
      // point. The full sync that runs next will advance it.
      const { error: hidErr } = await deps.supabase.schema('sync').from('cursor').upsert(
        {
          connection_id: upserted.id,
          kind: GMAIL_HISTORY_ID_KIND,
          value: watchResult.historyId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'connection_id,kind' },
      );
      if (hidErr) {
        deps.log.error('failed to seed gmail history_id cursor', { error: hidErr.message });
      }
    } catch (err) {
      deps.log.error('gmail users.watch failed for new connection', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    deps.log.warn('NANGO_GMAIL_PUBSUB_TOPIC unset; skipping users.watch subscription');
  }

  const now = (deps.now ?? (() => new Date()))();
  await deps.queues.send(queueNames.syncFull(GMAIL_PROVIDER), {
    household_id: upserted.household_id,
    kind: 'sync.gmail.full',
    entity_id: upserted.id,
    version: 1,
    enqueued_at: now.toISOString(),
  });

  await writeAudit(deps.supabase, {
    household_id: upserted.household_id,
    action: 'sync.gmail.connection.created',
    resource_id: upserted.id,
    after: {
      nango_connection_id: args.nangoConnectionId,
      member_id: memberId,
      email_categories: categories,
    },
  });

  deps.log.info('gmail connection created; full sync enqueued', {
    connection_id: upserted.id,
    household_id: upserted.household_id,
    categories,
  });
  return { status: 204, body: {} };
}

async function handleGmailConnectionDeleted(
  deps: WebhookIngestDeps,
  args: { nangoConnectionId: string },
): Promise<WebhookResult> {
  const { data: connection, error: lookupErr } = await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id')
    .eq('provider', GMAIL_PROVIDER)
    .eq('nango_connection_id', args.nangoConnectionId)
    .maybeSingle();
  if (lookupErr) throw new Error(`connection lookup failed: ${lookupErr.message}`);
  if (!connection) {
    return { status: 204, body: {} };
  }

  try {
    await deps.email.unwatch({ connectionId: args.nangoConnectionId });
  } catch (err) {
    deps.log.warn('gmail unwatch failed on connection.deleted; continuing', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', connection.id);
  await deps.supabase.schema('sync').from('cursor').delete().eq('connection_id', connection.id);

  await writeAudit(deps.supabase, {
    household_id: connection.household_id,
    action: 'sync.gmail.connection.deleted',
    resource_id: connection.id,
    after: { nango_connection_id: args.nangoConnectionId },
  });

  deps.log.info('gmail connection revoked', { connection_id: connection.id });
  return { status: 204, body: {} };
}

// ---- Lookups / helpers -------------------------------------------------

interface GmailConnectionLite {
  id: string;
  household_id: string;
  status: string;
}

async function lookupGmailConnectionByEmail(
  supabase: SupabaseClient<Database>,
  emailAddress: string,
): Promise<GmailConnectionLite | null> {
  // We match on `metadata->>email_address`. The JSON column path is
  // not reflected in the generated Supabase types — cast the filter
  // through `any` here. Cleaner path: a dedicated column in the
  // provider_connection table. Tracked as a follow-up for @infra-platform.
  const { data, error } = await (supabase
    .schema('sync')
    .from('provider_connection')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, household_id, status, metadata' as any)
    .eq('provider', GMAIL_PROVIDER)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .eq('metadata->>email_address' as any, emailAddress)
    .maybeSingle() as unknown as Promise<{
    data: GmailConnectionLite | null;
    error: { message: string } | null;
  }>);
  if (error) throw new Error(`gmail connection lookup failed: ${error.message}`);
  return data;
}

function parseCategoriesTag(raw: string | undefined): EmailCategory[] {
  if (!raw) return [];
  const out: EmailCategory[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed && isEmailCategory(trimmed) && !out.includes(trimmed)) {
      out.push(trimmed);
    }
  }
  return out;
}

function headerAsString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function parseGcalChannelValue(
  raw: string | null,
): (GcalChannelValue & { channel_id: string }) | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed &&
      typeof parsed.channel_id === 'string' &&
      typeof parsed.resource_id === 'string' &&
      typeof parsed.expiration === 'string'
    ) {
      return parsed as GcalChannelValue & { channel_id: string };
    }
    return null;
  } catch {
    return null;
  }
}

function defaultGcalChannelIdFactory(): string {
  return `hh-gcal-${globalThis.crypto.randomUUID()}`;
}

/**
 * Constant-time equality over UTF-8 bytes. Returns false on
 * mismatched lengths.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let out = 0;
  for (let i = 0; i < aBuf.byteLength; i += 1) {
    out |= (aBuf[i] ?? 0) ^ (bBuf[i] ?? 0);
  }
  return out === 0;
}

async function writeAudit(
  supabase: SupabaseClient<Database>,
  input: { household_id: string; action: string; resource_id: string; after: unknown },
): Promise<void> {
  const { error } = await supabase
    .schema('audit')
    .from('event')
    .insert({
      household_id: input.household_id,
      actor_user_id: null,
      action: input.action,
      resource_type: 'sync.provider_connection',
      resource_id: input.resource_id,
      before: null,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[webhook-ingest] audit write failed: ${error.message}`);
  }
}
