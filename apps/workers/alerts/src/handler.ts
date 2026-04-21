/**
 * `alerts` handler — cron-driven (daily 06:00 UTC) financial alerts + a
 * pre-step that upserts subscription nodes from last-90d transactions.
 *
 * Spec anchors:
 *   - `specs/05-agents/alerts.md` (alert shape, severity, delivery).
 *   - `specs/06-segments/financial/summaries-alerts.md` (detector list +
 *     thresholds).
 *
 * Pipeline per household:
 *   1. Load transactions / accounts / budgets / subscription nodes /
 *      household settings.
 *   2. Run `detectSubscriptions` over last 90d of transactions. For each
 *      candidate upsert a `mem.node` of type `subscription` (keeping
 *      member-confirmed nodes untouched). Tag matched transactions with
 *      `metadata.recurring_signal`. Enqueue `node_regen` for new nodes
 *      so downstream embeddings stay fresh. Collect newly-created
 *      subscription nodes for the `new_recurring_charge` alerter.
 *   3. Call every detector and aggregate emissions.
 *   4. Dedupe against active alerts with matching `(household_id, kind,
 *      dedupeKey)` in the last 24h. Dedupe is implemented at the
 *      application layer — M5-B does not yet have `kind` / `dedupe_key`
 *      columns on `app.alert`; we stash them in `context`.
 *   5. Insert `app.alert` rows.
 *   6. Audit `alerts.generated`.
 *
 * Cost discipline: detectors are pure, no model calls. A household with
 * no transactions in the lookback window still cheap-cycles (the queries
 * short-circuit on empty result sets).
 */

import {
  DEFAULT_HOUSEHOLD_ALERT_SETTINGS,
  type AccountRow as AlertAccountRow,
  type AlertEmission,
  type BudgetRow as AlertBudgetRow,
  type HouseholdAlertSettings,
  type SubscriptionNode,
  type TransactionRow as AlertTransactionRow,
  detectAccountStale,
  detectBudgetOverThreshold,
  detectDuplicateCharge,
  detectLargeTransaction,
  detectNewRecurringCharge,
  detectPaymentFailed,
  detectSubscriptionPriceIncrease,
  detectSubscriptions,
  type SubscriptionCandidate,
} from '@homehub/alerts';
import { type Database, type Json } from '@homehub/db';
import { queueNames, type Logger, type QueueClient } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

export const ALERT_DEDUPE_WINDOW_HOURS = 24;
export const ALERTS_LOOKBACK_DAYS = 90;

export interface AlertsWorkerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  now?: () => Date;
  /** Scope the run to a household subset. Defaults to all. */
  householdIds?: string[];
}

export interface AlertsRunSummary {
  householdId: string;
  emissions: number;
  inserted: number;
  dedupedSuppressed: number;
  subscriptionsUpserted: number;
  subscriptionsCreated: number;
}

export async function runAlertsWorker(deps: AlertsWorkerDeps): Promise<AlertsRunSummary[]> {
  const now = (deps.now ?? (() => new Date()))();
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const summaries: AlertsRunSummary[] = [];

  for (const householdId of householdIds) {
    try {
      const summary = await runForHousehold(deps, householdId, now);
      summaries.push(summary);
    } catch (err) {
      deps.log.error('alerts: household run failed', {
        household_id: householdId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  deps.log.info('alerts run complete', {
    households: householdIds.length,
    emitted: summaries.reduce((acc, s) => acc + s.emissions, 0),
    inserted: summaries.reduce((acc, s) => acc + s.inserted, 0),
    suppressed: summaries.reduce((acc, s) => acc + s.dedupedSuppressed, 0),
  });
  return summaries;
}

async function runForHousehold(
  deps: AlertsWorkerDeps,
  householdId: string,
  now: Date,
): Promise<AlertsRunSummary> {
  const lookbackStart = new Date(now.getTime() - ALERTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [transactions, accounts, budgets, subscriptions, settings] = await Promise.all([
    loadTransactions(deps.supabase, householdId, lookbackStart),
    loadAccounts(deps.supabase, householdId),
    loadBudgets(deps.supabase, householdId),
    loadSubscriptions(deps.supabase, householdId),
    loadHouseholdSettings(deps.supabase, householdId),
  ]);

  // --- Subscription detector pre-step ---------------------------------
  const { upserted, created, txUpdates } = await upsertSubscriptions(deps, {
    householdId,
    transactions,
    existing: subscriptions,
  });
  // Refresh transactions' in-memory metadata with the new signals so
  // downstream detectors see the subscription pointer.
  applyRecurringSignalInMemory(transactions, txUpdates);

  // Enqueue node_regen for newly-created subscription nodes so doc
  // regeneration + embeddings pick them up.
  for (const node of created) {
    try {
      await deps.queues.send(queueNames.nodeRegen, {
        household_id: householdId,
        kind: 'node.regen',
        entity_id: node.id,
        version: 1,
        enqueued_at: now.toISOString(),
      });
    } catch (err) {
      deps.log.warn('alerts: node_regen enqueue failed', {
        node_id: node.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const allSubscriptions = [...subscriptions, ...created];

  // --- Detectors -------------------------------------------------------
  const emissions: AlertEmission[] = [
    ...detectBudgetOverThreshold({ householdId, budgets, transactions, now }),
    ...detectPaymentFailed({ householdId, transactions, now }),
    ...detectLargeTransaction({ householdId, transactions, settings, now }),
    ...detectSubscriptionPriceIncrease({
      householdId,
      subscriptions: allSubscriptions,
      transactions,
      now,
    }),
    ...detectAccountStale({ householdId, accounts, now }),
    ...detectDuplicateCharge({ householdId, transactions, now }),
    ...detectNewRecurringCharge({ householdId, newlyCreated: created }),
  ];

  // --- Dedupe + insert -------------------------------------------------
  const activeKeys = await loadActiveDedupeKeys(deps.supabase, householdId, now);
  let inserted = 0;
  let suppressed = 0;
  for (const emission of emissions) {
    const key = `${emission.kind}::${emission.dedupeKey}`;
    if (activeKeys.has(key)) {
      suppressed += 1;
      continue;
    }
    try {
      await insertAlert(deps.supabase, emission, householdId);
      activeKeys.add(key);
      inserted += 1;
    } catch (err) {
      deps.log.warn('alerts: insert failed', {
        kind: emission.kind,
        dedupe_key: emission.dedupeKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Audit -----------------------------------------------------------
  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'alerts.generated',
    resource_id: householdId,
    after: {
      emissions: emissions.length,
      inserted,
      suppressed,
      subscriptions_upserted: upserted.length,
      subscriptions_created: created.length,
    },
  });

  return {
    householdId,
    emissions: emissions.length,
    inserted,
    dedupedSuppressed: suppressed,
    subscriptionsUpserted: upserted.length,
    subscriptionsCreated: created.length,
  };
}

// ---- Subscription upsert ----------------------------------------------

interface SubscriptionUpsertResult {
  upserted: SubscriptionNode[];
  created: SubscriptionNode[];
  /** `{ txId: subscriptionNodeId }`. */
  txUpdates: Map<string, string>;
}

async function upsertSubscriptions(
  deps: AlertsWorkerDeps,
  args: {
    householdId: string;
    transactions: AlertTransactionRow[];
    existing: SubscriptionNode[];
  },
): Promise<SubscriptionUpsertResult> {
  const candidates = detectSubscriptions({
    householdId: args.householdId,
    transactions: args.transactions,
    now: new Date(),
  });

  const upserted: SubscriptionNode[] = [];
  const created: SubscriptionNode[] = [];
  const txUpdates = new Map<string, string>();

  // Build a name→existing-node index so we can decide create vs update.
  const existingByName = new Map<string, SubscriptionNode>();
  for (const node of args.existing) {
    existingByName.set(normalizeName(node.canonical_name), node);
  }

  for (const candidate of candidates) {
    const key = normalizeName(candidate.canonicalName);
    const existing = existingByName.get(key);

    if (existing && !existing.needs_review) {
      // Member-confirmed — do not overwrite. Still re-tag transactions so
      // the price-increase detector has an up-to-date pointer.
      for (const txId of candidate.matchedTransactionIds) {
        txUpdates.set(txId, existing.id);
      }
      upserted.push(existing);
      continue;
    }

    const metadata = buildMetadata(candidate);
    if (existing) {
      const { error } = await deps.supabase
        .schema('mem')
        .from('node')
        .update({ metadata: metadata as unknown as Json, needs_review: false })
        .eq('id', existing.id);
      if (error) {
        deps.log.warn('alerts: subscription node update failed', {
          node_id: existing.id,
          error: error.message,
        });
        continue;
      }
      const updated: SubscriptionNode = {
        ...existing,
        metadata,
        needs_review: false,
      };
      upserted.push(updated);
      for (const txId of candidate.matchedTransactionIds) txUpdates.set(txId, existing.id);
      continue;
    }

    // New subscription node.
    const insertedId = await insertSubscriptionNode(deps.supabase, args.householdId, candidate);
    if (!insertedId) continue;
    const node: SubscriptionNode = {
      id: insertedId,
      household_id: args.householdId,
      canonical_name: candidate.canonicalName,
      metadata,
      needs_review: false,
      created_at: new Date().toISOString(),
    };
    created.push(node);
    upserted.push(node);
    for (const txId of candidate.matchedTransactionIds) txUpdates.set(txId, insertedId);
  }

  // Persist `transaction.metadata.recurring_signal` updates.
  for (const [txId, subId] of txUpdates) {
    const existingTx = args.transactions.find((t) => t.id === txId);
    if (!existingTx) continue;
    if (existingTx.metadata?.recurring_signal === subId) continue;
    const merged = {
      ...(existingTx.metadata ?? {}),
      recurring_signal: subId,
    };
    const { error } = await deps.supabase
      .schema('app')
      .from('transaction')
      .update({ metadata: merged as unknown as Json })
      .eq('id', txId);
    if (error) {
      deps.log.warn('alerts: tx recurring_signal update failed', {
        transaction_id: txId,
        error: error.message,
      });
    }
  }

  return { upserted, created, txUpdates };
}

async function insertSubscriptionNode(
  supabase: SupabaseClient<Database>,
  householdId: string,
  candidate: SubscriptionCandidate,
): Promise<string | null> {
  const insert: Database['mem']['Tables']['node']['Insert'] = {
    household_id: householdId,
    type: 'subscription',
    canonical_name: candidate.canonicalName,
    metadata: buildMetadata(candidate) as unknown as Json,
    needs_review: false,
  };
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .insert(insert)
    .select('id')
    .single();
  if (error) {
    // Duplicate node (unique on household+type+canonical_name). Fall
    // through and load the existing id instead of creating.
    const { data: existing, error: lookupErr } = await supabase
      .schema('mem')
      .from('node')
      .select('id')
      .eq('household_id', householdId)
      .eq('type', 'subscription')
      .eq('canonical_name', candidate.canonicalName)
      .maybeSingle();
    if (lookupErr || !existing) return null;
    return existing.id as string;
  }
  return (data?.id as string | undefined) ?? null;
}

function buildMetadata(candidate: SubscriptionCandidate): Record<string, unknown> {
  return {
    cadence: candidate.cadence,
    price_cents: candidate.priceCents,
    currency: candidate.currency,
    detected_by: 'alerts-worker',
  };
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

function applyRecurringSignalInMemory(
  transactions: AlertTransactionRow[],
  txUpdates: Map<string, string>,
): void {
  for (const tx of transactions) {
    const id = txUpdates.get(tx.id);
    if (!id) continue;
    tx.metadata = { ...(tx.metadata ?? {}), recurring_signal: id };
  }
}

// ---- Dedupe helpers ---------------------------------------------------

async function loadActiveDedupeKeys(
  supabase: SupabaseClient<Database>,
  householdId: string,
  now: Date,
): Promise<Set<string>> {
  const windowStart = new Date(
    now.getTime() - ALERT_DEDUPE_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .schema('app')
    .from('alert')
    .select('context, generated_at, dismissed_at')
    .eq('household_id', householdId)
    .gte('generated_at', windowStart);
  if (error) return new Set();
  const keys = new Set<string>();
  for (const row of data ?? []) {
    if (row.dismissed_at) continue;
    const ctx = row.context as Record<string, unknown> | null;
    if (!ctx || typeof ctx !== 'object') continue;
    const kind = ctx.alert_kind;
    const key = ctx.alert_dedupe_key;
    if (typeof kind === 'string' && typeof key === 'string') {
      keys.add(`${kind}::${key}`);
    }
  }
  return keys;
}

async function insertAlert(
  supabase: SupabaseClient<Database>,
  emission: AlertEmission,
  householdId: string,
): Promise<void> {
  const context = {
    ...emission.context,
    alert_kind: emission.kind,
    alert_dedupe_key: emission.dedupeKey,
  };
  const insert: Database['app']['Tables']['alert']['Insert'] = {
    household_id: householdId,
    segment: emission.segment,
    severity: emission.severity,
    title: emission.title,
    body: emission.body,
    generated_by: 'alerts-worker',
    context: context as unknown as Json,
  };
  const { error } = await supabase.schema('app').from('alert').insert(insert);
  if (error) {
    throw new Error(`alert insert failed: ${error.message}`);
  }
}

// ---- Loaders ----------------------------------------------------------

async function listHouseholds(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase.schema('app').from('household').select('id').limit(10_000);
  if (error) throw new Error(`household scan failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

async function loadTransactions(
  supabase: SupabaseClient<Database>,
  householdId: string,
  start: Date,
): Promise<AlertTransactionRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('transaction')
    .select(
      'id, household_id, account_id, occurred_at, amount_cents, currency, merchant_raw, category, source, metadata',
    )
    .eq('household_id', householdId)
    .gte('occurred_at', start.toISOString());
  if (error) throw new Error(`transaction lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    account_id: (r.account_id as string | null) ?? null,
    occurred_at: r.occurred_at as string,
    amount_cents: Number(r.amount_cents),
    currency: r.currency as string,
    merchant_raw: (r.merchant_raw as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    source: r.source as string,
    memo: null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

async function loadAccounts(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<AlertAccountRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('account')
    .select('id, household_id, name, kind, balance_cents, currency, last_synced_at')
    .eq('household_id', householdId);
  if (error) throw new Error(`account lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    name: r.name as string,
    kind: r.kind as string,
    balance_cents: r.balance_cents === null ? null : Number(r.balance_cents),
    currency: r.currency as string,
    last_synced_at: (r.last_synced_at as string | null) ?? null,
  }));
}

async function loadBudgets(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<AlertBudgetRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('budget')
    .select('id, household_id, name, category, period, amount_cents, currency')
    .eq('household_id', householdId);
  if (error) throw new Error(`budget lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    name: r.name as string,
    category: r.category as string,
    period: r.period as 'weekly' | 'monthly' | 'yearly',
    amount_cents: Number(r.amount_cents),
    currency: r.currency as string,
  }));
}

async function loadSubscriptions(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<SubscriptionNode[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('id, household_id, canonical_name, metadata, needs_review, created_at')
    .eq('household_id', householdId)
    .eq('type', 'subscription');
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    canonical_name: r.canonical_name as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    needs_review: Boolean(r.needs_review),
    created_at: r.created_at as string,
  }));
}

async function loadHouseholdSettings(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<HouseholdAlertSettings> {
  const { data, error } = await supabase
    .schema('app')
    .from('household')
    .select('settings')
    .eq('id', householdId)
    .maybeSingle();
  if (error || !data) return DEFAULT_HOUSEHOLD_ALERT_SETTINGS;
  const settings = data.settings as Record<string, unknown> | null;
  const financial =
    settings && typeof settings === 'object'
      ? (settings.financial as Record<string, unknown> | undefined)
      : undefined;
  const raw = financial?.large_transaction_threshold_cents;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return { largeTransactionThresholdCents: raw };
  }
  return DEFAULT_HOUSEHOLD_ALERT_SETTINGS;
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
      resource_type: 'app.alert',
      resource_id: input.resource_id,
      before: null,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-alerts] audit write failed: ${error.message}`);
  }
}

// Legacy stub — kept to break cleanly if something imports the old shape.
export async function handler(): Promise<void> {
  throw new Error('alerts: use runAlertsWorker() instead of handler()');
}
