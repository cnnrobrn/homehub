/**
 * `sync-grocery` handler.
 *
 * Consumes messages from the per-provider queues:
 *   - `sync_full:{provider}`  — initial order backfill.
 *   - `sync_delta:{provider}` — incremental pull triggered by cron or
 *     webhook ingestion.
 *
 * Today the only provider wired up is the stub (see
 * `@homehub/providers-grocery`). The real Instacart adapter throws
 * `InstacartNotConfiguredError` until operator credentials land, so we
 * gate ingestion behind `HOMEHUB_GROCERY_INGESTION_ENABLED` (default
 * false). When the flag is off, the worker still exercises the queue +
 * audit path but performs no DB writes.
 *
 * Error policy mirrors `sync-financial`:
 *   - `GroceryRateLimitError` → nack with the carried retry-after.
 *   - Anything else → dead-letter with reason and ack.
 */

import { type Database, type Json } from '@homehub/db';
import {
  GroceryRateLimitError,
  GrocerySyncError,
  type GroceryOrder,
  type GroceryProvider,
} from '@homehub/providers-grocery';
import {
  type Logger,
  type MessageEnvelope,
  type QueueClient,
  queueNames,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

export const GROCERY_PROVIDERS = ['instacart', 'stub'] as const;
export type GroceryProviderName = (typeof GROCERY_PROVIDERS)[number];

export interface GrocerySyncHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  providerFor: (providerName: GroceryProviderName) => GroceryProvider | null;
  log: Logger;
  /** Feature flag; false → worker no-ops persist and still acks. */
  ingestionEnabled: boolean;
  now?: () => Date;
}

export type SyncMode = 'full' | 'delta';

interface ConnectionRow {
  id: string;
  household_id: string;
  member_id: string | null;
  provider: string;
  nango_connection_id: string;
  status: string;
  metadata: Json | null;
}

export async function pollOnce(deps: GrocerySyncHandlerDeps): Promise<'claimed' | 'idle'> {
  for (const providerName of GROCERY_PROVIDERS) {
    const fullQueue = queueNames.syncFull(providerName);
    const deltaQueue = queueNames.syncDelta(providerName);

    for (const [queue, mode] of [
      [fullQueue, 'full'],
      [deltaQueue, 'delta'],
    ] as const) {
      const claimed = await deps.queues.claim(queue);
      if (!claimed) continue;

      const log = deps.log.child({
        queue,
        message_id: claimed.messageId,
        household_id: claimed.payload.household_id,
        entity_id: claimed.payload.entity_id,
        provider: providerName,
        mode,
      });

      try {
        await runSync(
          { ...deps, log },
          {
            providerName,
            mode,
            connectionId: claimed.payload.entity_id,
            envelope: claimed.payload,
          },
        );
        await deps.queues.ack(queue, claimed.messageId);
        return 'claimed';
      } catch (err) {
        if (err instanceof GroceryRateLimitError) {
          log.warn('provider rate limit; nacking with visibility bump', {
            retry_after_seconds: err.retryAfterSeconds,
          });
          await deps.queues.nack(queue, claimed.messageId, {
            retryDelaySec: err.retryAfterSeconds,
          });
          return 'claimed';
        }
        const reason = err instanceof Error ? err.message : String(err);
        log.error('sync-grocery handler failed; dead-lettering', { error: reason });
        await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
        await deps.queues.ack(queue, claimed.messageId);
        return 'claimed';
      }
    }
  }
  return 'idle';
}

interface RunSyncArgs {
  providerName: GroceryProviderName;
  mode: SyncMode;
  connectionId: string;
  envelope: MessageEnvelope;
}

async function runSync(deps: GrocerySyncHandlerDeps, args: RunSyncArgs): Promise<void> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const connection = await loadConnection(supabase, args.connectionId);
  if (!connection) {
    throw new GrocerySyncError(`connection not found: ${args.connectionId}`);
  }
  if (connection.provider !== args.providerName) {
    throw new GrocerySyncError(
      `connection ${connection.id} is provider=${connection.provider}, expected ${args.providerName}`,
    );
  }
  if (connection.status === 'revoked') {
    throw new GrocerySyncError(`connection ${connection.id} is revoked`);
  }

  const provider = deps.providerFor(args.providerName);
  if (!provider) {
    throw new GrocerySyncError(`no provider implementation wired for ${args.providerName}`);
  }

  log.info('sync starting', {
    nango_connection_id: connection.nango_connection_id,
    ingestion_enabled: deps.ingestionEnabled,
  });

  let orders: GroceryOrder[] = [];
  if (deps.ingestionEnabled || args.providerName === 'stub') {
    orders = await provider.listRecentOrders({
      connectionId: connection.nango_connection_id,
      sinceDays: args.mode === 'full' ? 365 : 30,
    });
    log.info('orders fetched', { count: orders.length });
  } else {
    log.info('grocery ingestion disabled; skipping provider fetch');
  }

  let upsertedCount = 0;
  if (deps.ingestionEnabled && orders.length > 0) {
    upsertedCount = await upsertOrders(supabase, connection, args.providerName, orders, now);
  }

  // Stamp last_synced_at regardless of ingestion flag.
  await supabase
    .schema('sync')
    .from('provider_connection')
    .update({ last_synced_at: now.toISOString(), status: 'active' })
    .eq('id', connection.id);

  await writeAudit(supabase, {
    household_id: connection.household_id,
    action: `sync.${args.providerName}.${args.mode}.completed`,
    resource_id: connection.id,
    after: {
      upserted_orders: upsertedCount,
      ingestion_enabled: deps.ingestionEnabled,
    },
  });

  log.info('sync completed', { upserted_orders: upsertedCount });
}

async function loadConnection(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id, member_id, provider, nango_connection_id, status, metadata')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new GrocerySyncError(`provider_connection lookup: ${error.message}`);
  return data as ConnectionRow | null;
}

async function upsertOrders(
  supabase: SupabaseClient<Database>,
  connection: ConnectionRow,
  providerName: GroceryProviderName,
  orders: GroceryOrder[],
  now: Date,
): Promise<number> {
  let count = 0;
  for (const order of orders) {
    // Status mapping: our `app.grocery_list.status` has:
    //   'draft','ordered','received','cancelled'. Provider 'placed' →
    //   'ordered'; 'fulfilled' → 'received'.
    const status =
      order.status === 'placed'
        ? 'ordered'
        : order.status === 'fulfilled'
          ? 'received'
          : order.status;

    const { data: inserted, error: listErr } = await supabase
      .schema('app')
      .from('grocery_list')
      .upsert(
        {
          household_id: connection.household_id,
          status,
          provider: providerName,
          external_order_id: order.sourceId,
          planned_for: order.deliveryWindow?.start?.slice(0, 10) ?? null,
          updated_at: now.toISOString(),
        },
        { onConflict: 'provider,external_order_id' },
      )
      .select('id')
      .single();
    if (listErr) {
      // If the unique index isn't present (migration 0006 didn't ship
      // one), fall back to insert-only. Don't fail the batch.
      if (!/unique/i.test(listErr.message)) {
        throw new GrocerySyncError(`grocery_list upsert: ${listErr.message}`);
      }
      continue;
    }
    const listId = inserted.id as string;

    // Replace list items (cheaper + simpler than per-row diff).
    const { error: delErr } = await supabase
      .schema('app')
      .from('grocery_list_item')
      .delete()
      .eq('list_id', listId);
    if (delErr) throw new GrocerySyncError(`grocery_list_item delete: ${delErr.message}`);

    const itemRows = order.items.map((i) => ({
      list_id: listId,
      household_id: connection.household_id,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit ?? null,
      checked: false,
    }));
    if (itemRows.length > 0) {
      const { error: itemErr } = await supabase
        .schema('app')
        .from('grocery_list_item')
        .insert(itemRows);
      if (itemErr) throw new GrocerySyncError(`grocery_list_item insert: ${itemErr.message}`);
    }
    count += 1;
  }
  return count;
}

async function writeAudit(
  supabase: SupabaseClient<Database>,
  input: {
    household_id: string;
    action: string;
    resource_id: string;
    after: unknown;
  },
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
    console.warn(`[sync-grocery] audit write failed: ${error.message}`);
  }
}

/**
 * Cron fan-out: enqueue `sync_delta` for every active grocery
 * connection. When no connections exist (common until operators wire
 * Instacart), the call is a cheap no-op.
 */
export async function runGroceryCron(deps: {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  now?: () => Date;
}): Promise<{ enqueued: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const { data, error } = await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id, provider, status')
    .in('provider', GROCERY_PROVIDERS as unknown as string[])
    .eq('status', 'active');
  if (error) throw new GrocerySyncError(`cron connection lookup: ${error.message}`);

  let enqueued = 0;
  for (const row of data ?? []) {
    const providerName = row.provider as GroceryProviderName;
    await deps.queues.send(queueNames.syncDelta(providerName), {
      household_id: row.household_id,
      kind: `sync.${providerName}.delta`,
      entity_id: row.id,
      version: 1,
      enqueued_at: now.toISOString(),
    });
    enqueued += 1;
  }
  deps.log.info('grocery cron fan-out complete', { enqueued });
  return { enqueued };
}
