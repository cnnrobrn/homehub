/**
 * Shared post-connect side-effects for Google (gcal + gmail).
 *
 * Both entry points into HomeHub's Google integration need the same
 * follow-up work after a connection is minted:
 *   - webhook-ingest (legacy path, Nango-brokered connections)
 *   - the native /api/oauth/google/callback route (new path)
 *
 * This module factors the shared work so both callers stay in sync.
 *
 * We intentionally use structural types (`MinimalCalendarProvider` /
 * `MinimalEmailProvider`) instead of importing from the providers
 * packages. Otherwise worker-runtime → providers creates a circular dep,
 * since providers already depend on worker-runtime for `NangoClient` +
 * errors. Each structural type lists only the methods this helper
 * actually calls; the real providers satisfy them by construction.
 */

import { type SupabaseClient } from '@supabase/supabase-js';

import { type Logger } from '../log/logger.js';
import { type QueueClient } from '../queue/client.js';
import { queueNames } from '../queue/registry.js';

export const GCAL_CHANNEL_KIND = 'gcal.channel';
export const GMAIL_WATCH_KIND = 'gmail.watch';
export const GMAIL_HISTORY_ID_KIND = 'gmail.history_id';

export interface MinimalCalendarProvider {
  watch(args: {
    connectionId: string;
    channelId: string;
    webhookUrl: string;
  }): Promise<{ channelId: string; resourceId: string; expiration: string }>;
  unwatch(args: { connectionId: string; channelId: string; resourceId: string }): Promise<void>;
}

export interface MinimalEmailProvider {
  ensureLabel(args: { connectionId: string; name: string }): Promise<{ labelId: string }>;
  watch(args: {
    connectionId: string;
    topicName: string;
    labelIds?: string[];
  }): Promise<{ historyId: string; expiration: string }>;
  unwatch(args: { connectionId: string }): Promise<void>;
}

export interface GoogleConnectionIdentity {
  /** The opaque id workers pass to provider.*  (Nango's id or our UUID). */
  connectionId: string;
  /** `sync.provider_connection.id` for this row. */
  providerConnectionId: string;
  householdId: string;
}

export interface PostConnectEnv {
  WEBHOOK_PUBLIC_URL?: string;
  NANGO_GMAIL_PUBSUB_TOPIC?: string;
}

export interface PostConnectDeps {
  supabase: SupabaseClient;
  queues: QueueClient;
  log: Logger;
  env: PostConnectEnv;
  now?: () => Date;
  channelIdFactory?: () => string;
}

export async function runGcalPostConnect(
  deps: PostConnectDeps & { calendar: MinimalCalendarProvider },
  identity: GoogleConnectionIdentity,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const channelIdFactory = deps.channelIdFactory ?? defaultGcalChannelIdFactory;

  if (deps.env.WEBHOOK_PUBLIC_URL) {
    try {
      const channelId = channelIdFactory();
      const watchResult = await deps.calendar.watch({
        connectionId: identity.connectionId,
        channelId,
        webhookUrl: `${deps.env.WEBHOOK_PUBLIC_URL.replace(/\/$/, '')}/webhooks/google-calendar`,
      });
      const { error: cursorErr } = await deps.supabase
        .schema('sync' as never)
        .from('cursor' as never)
        .upsert(
          {
            connection_id: identity.providerConnectionId,
            kind: GCAL_CHANNEL_KIND,
            value: JSON.stringify({
              channel_id: watchResult.channelId,
              resource_id: watchResult.resourceId,
              expiration: watchResult.expiration,
            }),
            updated_at: now.toISOString(),
          },
          { onConflict: 'connection_id,kind' },
        );
      if (cursorErr) {
        deps.log.error('failed to persist gcal channel cursor', { error: cursorErr.message });
      }
    } catch (err) {
      deps.log.error('events.watch failed for new gcal connection', {
        connection_id: identity.connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    deps.log.warn('WEBHOOK_PUBLIC_URL unset; skipping events.watch subscription');
  }

  await deps.queues.send(queueNames.syncFull('gcal'), {
    household_id: identity.householdId,
    kind: 'sync.gcal.full',
    entity_id: identity.providerConnectionId,
    version: 1,
    enqueued_at: now.toISOString(),
  });
}

export interface GmailPostConnectOptions extends GoogleConnectionIdentity {
  emailAddress?: string;
  /** Label the initial full sync applies. Defaults to `HomeHub/Ingested`. */
  labelName?: string;
}

export async function runGmailPostConnect(
  deps: PostConnectDeps & { email: MinimalEmailProvider },
  options: GmailPostConnectOptions,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const labelName = options.labelName ?? 'HomeHub/Ingested';

  // Non-fatal on failure — the sync worker re-ensures on first run.
  try {
    await deps.email.ensureLabel({ connectionId: options.connectionId, name: labelName });
  } catch (err) {
    deps.log.warn('gmail ensureLabel failed in post-connect; worker will retry', {
      connection_id: options.connectionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (deps.env.NANGO_GMAIL_PUBSUB_TOPIC) {
    try {
      const watchResult = await deps.email.watch({
        connectionId: options.connectionId,
        topicName: deps.env.NANGO_GMAIL_PUBSUB_TOPIC,
        labelIds: ['INBOX'],
      });
      const watchValue = {
        history_id: watchResult.historyId,
        expiration: watchResult.expiration,
        ...(options.emailAddress ? { email_address: options.emailAddress } : {}),
      };
      const { error: watchErr } = await deps.supabase
        .schema('sync' as never)
        .from('cursor' as never)
        .upsert(
          {
            connection_id: options.providerConnectionId,
            kind: GMAIL_WATCH_KIND,
            value: JSON.stringify(watchValue),
            updated_at: now.toISOString(),
          },
          { onConflict: 'connection_id,kind' },
        );
      if (watchErr) {
        deps.log.error('failed to persist gmail watch cursor', { error: watchErr.message });
      }
      const { error: hidErr } = await deps.supabase
        .schema('sync' as never)
        .from('cursor' as never)
        .upsert(
          {
            connection_id: options.providerConnectionId,
            kind: GMAIL_HISTORY_ID_KIND,
            value: watchResult.historyId,
            updated_at: now.toISOString(),
          },
          { onConflict: 'connection_id,kind' },
        );
      if (hidErr) {
        deps.log.error('failed to seed gmail history_id cursor', { error: hidErr.message });
      }
    } catch (err) {
      deps.log.error('gmail users.watch failed for new connection', {
        connection_id: options.connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    deps.log.warn('NANGO_GMAIL_PUBSUB_TOPIC unset; skipping users.watch subscription');
  }

  await deps.queues.send(queueNames.syncFull('gmail'), {
    household_id: options.householdId,
    kind: 'sync.gmail.full',
    entity_id: options.providerConnectionId,
    version: 1,
    enqueued_at: now.toISOString(),
  });
}

/** Used when a google row is revoked via the callback-path disconnect. */
export async function runGoogleDisconnectCleanup(deps: {
  supabase: SupabaseClient;
  log: Logger;
  calendar?: MinimalCalendarProvider;
  email?: MinimalEmailProvider;
  provider: 'gcal' | 'gmail';
  identity: GoogleConnectionIdentity;
}): Promise<void> {
  if (deps.provider === 'gcal' && deps.calendar) {
    const { data: channelCursor } = await deps.supabase
      .schema('sync' as never)
      .from('cursor' as never)
      .select('value')
      .eq('connection_id', deps.identity.providerConnectionId)
      .eq('kind', GCAL_CHANNEL_KIND)
      .maybeSingle();
    const parsed = parseGcalChannelValue(
      (channelCursor as { value?: string } | null)?.value ?? null,
    );
    if (parsed) {
      try {
        await deps.calendar.unwatch({
          connectionId: deps.identity.connectionId,
          channelId: parsed.channel_id,
          resourceId: parsed.resource_id,
        });
      } catch (err) {
        deps.log.warn('gcal unwatch failed on disconnect; continuing', {
          connection_id: deps.identity.connectionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  if (deps.provider === 'gmail' && deps.email) {
    try {
      await deps.email.unwatch({ connectionId: deps.identity.connectionId });
    } catch (err) {
      deps.log.warn('gmail unwatch failed on disconnect; continuing', {
        connection_id: deps.identity.connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await deps.supabase
    .schema('sync' as never)
    .from('cursor' as never)
    .delete()
    .eq('connection_id', deps.identity.providerConnectionId);
}

function defaultGcalChannelIdFactory(): string {
  return `hh-gcal-${globalThis.crypto.randomUUID()}`;
}

function parseGcalChannelValue(
  raw: string | null,
): { channel_id: string; resource_id: string; expiration: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed &&
      typeof (parsed as { channel_id?: unknown }).channel_id === 'string' &&
      typeof (parsed as { resource_id?: unknown }).resource_id === 'string' &&
      typeof (parsed as { expiration?: unknown }).expiration === 'string'
    ) {
      return parsed as { channel_id: string; resource_id: string; expiration: string };
    }
    return null;
  } catch {
    return null;
  }
}
