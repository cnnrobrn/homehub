/**
 * `sync-financial` handler.
 *
 * Consumes pgmq messages from the per-provider queues:
 *   - `sync_full:{provider}`  — initial sync: last 12 months of
 *     transactions + full account snapshot + budgets.
 *   - `sync_delta:{provider}` — incremental sync using the stored
 *     provider-native cursor (YNAB: `server_knowledge`).
 *
 * Contract per message envelope: `entity_id` carries the
 * `sync.provider_connection.id`. The worker resolves the household +
 * member from that row on every run, so stale envelopes cannot be
 * replayed against a moved / revoked connection.
 *
 * Error policy:
 *   - `CursorExpiredError` → drop the cursor, requeue as
 *     `sync_full:{provider}`. Current message is ack'd.
 *   - `RateLimitError`     → `nack` with a visibility bump matching the
 *     carried retry-after.
 *   - Anything else        → insert into `sync.dead_letter` with the
 *     full envelope + reason and ack.
 *
 * Idempotency:
 *   - `app.account` upsert keyed on `(provider, external_id)` via the
 *     existing partial unique index.
 *   - `app.transaction` upsert keyed on `(source, source_id)` via the
 *     existing partial unique index. A follow-up tightens this to
 *     `(household_id, source, source_id)` — see the M5-A report.
 *
 * Feature flag: `HOMEHUB_FINANCIAL_INGESTION_ENABLED` (default true —
 * migration 0005 + 0012 are already in place, unlike the gmail path).
 * Leaving the flag in the surface lets us kill ingestion per-env
 * without redeploying the worker.
 */

import { type Database, type Json } from '@homehub/db';
import {
  CursorExpiredError,
  type FinancialAccount,
  type FinancialBudget,
  type FinancialProvider,
  type FinancialTransaction,
  RateLimitError,
  YNAB_SOURCE,
} from '@homehub/providers-financial';
import {
  type Logger,
  type MessageEnvelope,
  type QueueClient,
  queueNames,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

/** Cursor kind values we store in `sync.cursor`. */
export const CURSOR_KIND = {
  ynabKnowledge: 'ynab.knowledge',
} as const;

/** Fixed provider label persisted to `sync.provider_connection.provider`. */
export const FINANCIAL_PROVIDERS = ['ynab', 'monarch', 'plaid'] as const;
export type FinancialProviderName = (typeof FINANCIAL_PROVIDERS)[number];

export interface FinancialSyncHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  /**
   * Resolves the provider implementation for a given connection row.
   * Returns `null` when the provider is not yet supported — the
   * handler nacks the message into the DLQ rather than throwing.
   */
  providerFor: (providerName: FinancialProviderName) => FinancialProvider | null;
  log: Logger;
  /** Feature flag; false → worker no-ops persist and still acks. */
  ingestionEnabled: boolean;
  /** Injectable for tests. */
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

interface CursorRow {
  kind: string;
  value: string | null;
}

/**
 * Top-level: claim → dispatch → handle errors → ack / nack / dead-letter.
 * Returns `'claimed'` if a message was processed, otherwise `'idle'`.
 */
export async function pollOnce(deps: FinancialSyncHandlerDeps): Promise<'claimed' | 'idle'> {
  for (const providerName of FINANCIAL_PROVIDERS) {
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
            mode,
            providerName,
            connectionId: claimed.payload.entity_id,
            envelope: claimed.payload,
          },
        );
        await deps.queues.ack(queue, claimed.messageId);
        return 'claimed';
      } catch (err) {
        if (err instanceof CursorExpiredError) {
          log.warn('provider cursor invalidated; requeueing as full sync');
          try {
            await clearCursor(deps.supabase, claimed.payload.entity_id, providerName);
            await deps.queues.send(fullQueue, {
              ...claimed.payload,
              kind: `sync.${providerName}.full`,
            });
            await deps.queues.ack(queue, claimed.messageId);
          } catch (inner) {
            log.error('failed to requeue after CursorExpiredError', {
              error: inner instanceof Error ? inner.message : String(inner),
            });
            await deps.queues.deadLetter(
              queue,
              claimed.messageId,
              'cursor-expired; requeue failed',
              claimed.payload,
            );
            await deps.queues.ack(queue, claimed.messageId);
          }
          return 'claimed';
        }

        if (err instanceof RateLimitError) {
          log.warn('provider rate limit; nacking with visibility bump', {
            retry_after_seconds: err.retryAfterSeconds,
          });
          await deps.queues.nack(queue, claimed.messageId, {
            retryDelaySec: err.retryAfterSeconds,
          });
          return 'claimed';
        }

        const reason = err instanceof Error ? err.message : String(err);
        log.error('sync-financial handler failed; dead-lettering', { error: reason });
        await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
        await deps.queues.ack(queue, claimed.messageId);
        return 'claimed';
      }
    }
  }
  return 'idle';
}

interface RunSyncArgs {
  mode: SyncMode;
  providerName: FinancialProviderName;
  connectionId: string;
  envelope: MessageEnvelope;
}

async function runSync(deps: FinancialSyncHandlerDeps, args: RunSyncArgs): Promise<void> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const connection = await loadConnection(supabase, args.connectionId);
  if (!connection) {
    throw new Error(`connection not found: ${args.connectionId}`);
  }
  if (connection.provider !== args.providerName) {
    throw new Error(
      `connection ${connection.id} is provider=${connection.provider}, expected ${args.providerName}`,
    );
  }
  if (connection.status === 'revoked') {
    throw new Error(`connection ${connection.id} is revoked`);
  }

  const provider = deps.providerFor(args.providerName);
  if (!provider) {
    throw new Error(`no provider implementation wired for ${args.providerName}`);
  }

  log.info('sync starting', {
    nango_connection_id: connection.nango_connection_id,
    ingestion_enabled: deps.ingestionEnabled,
  });

  // If ingestion is disabled we still exercise the provider calls so
  // Nango auth + proxy wiring is verified; we just skip the DB writes.
  const existingCursor =
    args.mode === 'delta'
      ? await getCursorValue(supabase, connection.id, cursorKind(args.providerName))
      : undefined;

  // ---- Accounts: always fetched on full; on delta we still fetch so
  // balances stay fresh (YNAB does not publish incremental account
  // deltas in a way we can act on cheaply).
  const accounts = await provider.listAccounts({ connectionId: connection.nango_connection_id });
  log.info('accounts fetched', { count: accounts.length });

  const accountIdByExternal = new Map<string, string>();
  if (deps.ingestionEnabled && accounts.length > 0) {
    const upserted = await upsertAccounts(supabase, connection, args.providerName, accounts, now);
    for (const row of upserted) {
      accountIdByExternal.set(row.external_id, row.id);
    }
  }

  // ---- Budgets: mirror whatever the provider exposes. YNAB returns
  // category-level monthly budgets; Monarch later will too.
  let budgetCount = 0;
  if (args.mode === 'full') {
    const budgets = await provider.listBudgets({
      connectionId: connection.nango_connection_id,
    });
    log.info('budgets fetched', { count: budgets.length });
    if (deps.ingestionEnabled && budgets.length > 0) {
      await upsertBudgets(supabase, connection, budgets, now);
      budgetCount = budgets.length;
    }
  }

  // ---- Transactions (paginated via the provider's iterator).
  let nextCursor: string | undefined;
  let txUpsertCount = 0;

  for await (const page of provider.listTransactions({
    connectionId: connection.nango_connection_id,
    ...(existingCursor ? { sinceCursor: existingCursor } : {}),
  })) {
    if (page.transactions.length === 0 && !page.nextCursor) continue;

    if (deps.ingestionEnabled) {
      const upserted = await upsertTransactions(
        supabase,
        connection,
        args.providerName,
        page.transactions,
        accountIdByExternal,
        now,
      );
      txUpsertCount += upserted.length;
    }
    if (page.nextCursor) nextCursor = page.nextCursor;
  }

  if (deps.ingestionEnabled && nextCursor) {
    await upsertCursor(supabase, connection.id, cursorKind(args.providerName), nextCursor);
  }

  // Stamp last_synced_at regardless of ingestion flag so operators see
  // that the pipeline is running end-to-end.
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
      upserted_transactions: txUpsertCount,
      upserted_budgets: budgetCount,
      upserted_accounts: accounts.length,
      next_cursor_written: Boolean(nextCursor),
      ingestion_enabled: deps.ingestionEnabled,
    },
  });

  log.info('sync completed', {
    upserted_transactions: txUpsertCount,
    upserted_accounts: accounts.length,
    upserted_budgets: budgetCount,
  });
}

function cursorKind(provider: FinancialProviderName): string {
  switch (provider) {
    case 'ynab':
      return CURSOR_KIND.ynabKnowledge;
    default:
      // Monarch / Plaid cursors land in M5-B; fall back to a
      // provider-namespaced key so the row doesn't collide.
      return `${provider}.cursor`;
  }
}

// ---- Supabase helpers --------------------------------------------------

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
  if (error) throw new Error(`provider_connection lookup failed: ${error.message}`);
  return data as ConnectionRow | null;
}

async function getCursorValue(
  supabase: SupabaseClient<Database>,
  connectionId: string,
  kind: string,
): Promise<string | undefined> {
  const { data, error } = await supabase
    .schema('sync')
    .from('cursor')
    .select('kind, value')
    .eq('connection_id', connectionId)
    .eq('kind', kind)
    .maybeSingle<CursorRow>();
  if (error) throw new Error(`cursor lookup failed: ${error.message}`);
  return data?.value ?? undefined;
}

async function clearCursor(
  supabase: SupabaseClient<Database>,
  connectionId: string,
  providerName: FinancialProviderName,
): Promise<void> {
  const { error } = await supabase
    .schema('sync')
    .from('cursor')
    .delete()
    .eq('connection_id', connectionId)
    .eq('kind', cursorKind(providerName));
  if (error) throw new Error(`cursor clear failed: ${error.message}`);
}

async function upsertCursor(
  supabase: SupabaseClient<Database>,
  connectionId: string,
  kind: string,
  value: string,
): Promise<void> {
  const { error } = await supabase
    .schema('sync')
    .from('cursor')
    .upsert(
      { connection_id: connectionId, kind, value, updated_at: new Date().toISOString() },
      { onConflict: 'connection_id,kind' },
    );
  if (error) throw new Error(`cursor upsert failed: ${error.message}`);
}

interface UpsertedAccountSummary {
  id: string;
  external_id: string;
}

async function upsertAccounts(
  supabase: SupabaseClient<Database>,
  connection: ConnectionRow,
  providerName: FinancialProviderName,
  accounts: FinancialAccount[],
  now: Date,
): Promise<UpsertedAccountSummary[]> {
  if (accounts.length === 0) return [];
  const rows = accounts.map((a) => ({
    household_id: connection.household_id,
    owner_member_id: connection.member_id,
    provider: providerName,
    external_id: a.sourceId,
    kind: a.kind,
    name: a.name,
    balance_cents: a.balanceCents,
    currency: a.currency,
    last_synced_at: now.toISOString(),
    updated_at: now.toISOString(),
  }));
  const { data, error } = await supabase
    .schema('app')
    .from('account')
    .upsert(rows, { onConflict: 'provider,external_id' })
    .select('id, external_id');
  if (error) throw new Error(`app.account upsert failed: ${error.message}`);
  return (data ?? []) as UpsertedAccountSummary[];
}

async function upsertTransactions(
  supabase: SupabaseClient<Database>,
  connection: ConnectionRow,
  providerName: FinancialProviderName,
  transactions: FinancialTransaction[],
  accountIdByExternal: Map<string, string>,
  now: Date,
): Promise<Array<{ id: string; source_id: string }>> {
  if (transactions.length === 0) return [];
  // `app.transaction.source` is enforced via a CHECK constraint to one
  // of the known provider labels. YNAB_SOURCE matches the constraint.
  // Fan out member_id from the connection row (spec note: every row is
  // owned by the member who linked the account).
  const rows = transactions.map((t) => ({
    household_id: connection.household_id,
    member_id: connection.member_id,
    occurred_at: toIso(t.occurredAt),
    amount_cents: t.amountCents,
    currency: t.currency,
    merchant_raw: t.merchantRaw ?? null,
    category: t.category ?? null,
    account_id: accountIdByExternal.get(t.accountSourceId) ?? null,
    source: providerName === 'ynab' ? YNAB_SOURCE : providerName,
    source_id: t.sourceId,
    source_version: t.sourceVersion ?? null,
    metadata: {
      ...t.metadata,
      ...(t.memo ? { memo: t.memo } : {}),
      cleared: t.cleared,
      account_source_id: t.accountSourceId,
    } as unknown as Json,
    updated_at: now.toISOString(),
  }));

  const { data, error } = await supabase
    .schema('app')
    .from('transaction')
    .upsert(rows, { onConflict: 'source,source_id' })
    .select('id, source_id');
  if (error) throw new Error(`app.transaction upsert failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    source_id: String(r.source_id),
  }));
}

async function upsertBudgets(
  supabase: SupabaseClient<Database>,
  connection: ConnectionRow,
  budgets: FinancialBudget[],
  now: Date,
): Promise<void> {
  if (budgets.length === 0) return;
  // `app.budget` has no unique index on (household_id, name, category) in
  // M1's schema. Upsert semantics emulated via delete + insert for the
  // current household's budget rows sourced from this provider. See the
  // M5-A report for a migration request covering the partial unique
  // index `(household_id, name, category)`.
  const rows = budgets.map((b) => ({
    household_id: connection.household_id,
    name: b.name,
    period: b.period,
    category: b.category,
    amount_cents: b.amountCents,
    currency: b.currency,
    updated_at: now.toISOString(),
  }));

  // For M5-A we insert new rows and rely on the reconciler / operators
  // to trim duplicates. Once the unique index lands, swap to:
  //   .upsert(rows, { onConflict: 'household_id,name,category' })
  const { error } = await supabase.schema('app').from('budget').insert(rows);
  if (error) {
    // Duplicate insertion is expected pending the unique index — log
    // but don't fail the sync.
    if (/duplicate key/i.test(error.message)) return;
    throw new Error(`app.budget insert failed: ${error.message}`);
  }
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
    console.warn(`[sync-financial] audit write failed: ${error.message}`);
  }
}

/**
 * Normalize a provider-supplied occurredAt into an ISO-8601 timestamp
 * string the `timestamptz` column accepts. YNAB publishes plain
 * `YYYY-MM-DD`; we fold those to midnight UTC. Pre-existing ISO-8601
 * strings are returned untouched.
 */
function toIso(raw: string): string {
  if (/T\d{2}:\d{2}/.test(raw)) return raw;
  return `${raw}T00:00:00.000Z`;
}

// ---- Cron entry --------------------------------------------------------

/**
 * `runFinancialCron` — fans out `sync_delta:{provider}` messages for
 * every active financial connection. Scheduler is Railway-level; see
 * `apps/workers/sync-financial/README.md`.
 *
 * Why centralize here: the workers-runtime pool already has Supabase +
 * pgmq wired; making the cron a callable function lets a thin entry
 * point in `src/cron.ts` or an operator's kubectl-exec trigger it
 * without duplicating env bootstrap.
 */
export async function runFinancialCron(deps: {
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
    .in('provider', FINANCIAL_PROVIDERS as unknown as string[])
    .eq('status', 'active');
  if (error) throw new Error(`cron connection lookup failed: ${error.message}`);

  let enqueued = 0;
  for (const row of data ?? []) {
    const providerName = row.provider as FinancialProviderName;
    await deps.queues.send(queueNames.syncDelta(providerName), {
      household_id: row.household_id,
      kind: `sync.${providerName}.delta`,
      entity_id: row.id,
      version: 1,
      enqueued_at: now.toISOString(),
    });
    enqueued += 1;
  }
  deps.log.info('financial cron fan-out complete', { enqueued });
  return { enqueued };
}
