/**
 * `reconciler` handler — email-receipt ↔ provider-transaction.
 *
 * Spec: `specs/03-integrations/budgeting.md` ("Reconciliation").
 *
 * Invariant inputs:
 *   - `app.transaction` rows with `source = 'email_receipt'` (produced
 *     by the email-enrichment pipeline — cross-cut, owned by
 *     @memory-background, scheduled for M5-A/M5-B overlap).
 *   - `app.transaction` rows with `source in ('ynab', 'monarch',
 *     'plaid')` (this dispatch's sync-financial worker).
 *
 * Algorithm per household (hourly cron):
 *
 *   1. Select email-derived transactions in the last 30 days that have
 *      no `metadata->>matched_transaction_id`.
 *   2. For each, find candidate provider-side transactions in the same
 *      household where:
 *        - `|amount_cents - candidate.amount_cents| <= 100` (±$1.00)
 *        - `|occurred_at - candidate.occurred_at| <= 3 days`
 *        - merchant-name similarity > 0.8 (Jaro-Winkler).
 *   3. If exactly one candidate passes: link via metadata on both rows.
 *   4. If multiple: leave both visible; mark email row
 *      `metadata.status='ambiguous_match'`. UI surfaces these for
 *      manual resolution (M5-C).
 *   5. If zero: no-op.
 *
 *   Audit: `financial.reconciliation.completed` per run with counts.
 *
 * Today's reality: zero `source='email_receipt'` rows exist until the
 * enrichment worker starts writing them. The reconciler is a no-op in
 * that case and writes an audit row with `match_count = 0`.
 */

import { type Database, type Json } from '@homehub/db';
import { type Logger } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

/** 30-day lookback matches the budgeting spec. */
export const RECONCILE_LOOKBACK_DAYS = 30;

/** ±$1.00 amount tolerance. Amounts live in cents. */
export const AMOUNT_TOLERANCE_CENTS = 100;

/** ±3-day occurrence tolerance. */
export const DATE_TOLERANCE_DAYS = 3;

/** Minimum Jaro-Winkler similarity for an auto-match. */
export const MERCHANT_SIMILARITY_THRESHOLD = 0.8;

/** Transactions we treat as provider-side candidates. */
export const PROVIDER_SOURCES = ['ynab', 'monarch', 'plaid'] as const;

/** Email-derived source label written by the enrichment pipeline. */
export const EMAIL_RECEIPT_SOURCE = 'email_receipt';

export interface ReconcilerDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  now?: () => Date;
  /** Restrict the pass to a specific household set; defaults to all. */
  householdIds?: string[];
}

export interface ReconciliationSummary {
  householdId: string;
  emailTxConsidered: number;
  matchesLinked: number;
  ambiguousLeft: number;
  unmatchedLeft: number;
}

interface EmailTxRow {
  id: string;
  household_id: string;
  member_id: string | null;
  occurred_at: string;
  amount_cents: number;
  merchant_raw: string | null;
  metadata: Json;
}

interface ProviderTxRow {
  id: string;
  household_id: string;
  occurred_at: string;
  amount_cents: number;
  merchant_raw: string | null;
  source: string;
  metadata: Json;
}

/**
 * Top-level entry. Iterates households (or the caller-supplied subset),
 * runs the match algorithm, and returns a summary. Safe to call more
 * than once per hour — links are idempotent (we only write when a row
 * has no existing match).
 */
export async function runFinancialReconciler(
  deps: ReconcilerDeps,
): Promise<ReconciliationSummary[]> {
  const now = (deps.now ?? (() => new Date()))();
  const windowStartIso = new Date(
    now.getTime() - RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Resolve the set of households to reconcile. When no filter is
  // supplied we scope to households that have any email-derived row —
  // that keeps the iteration bounded to the households where the
  // reconciler has work to do.
  const householdIds = deps.householdIds ?? (await listHouseholdsWithEmailTx(deps.supabase));

  const summaries: ReconciliationSummary[] = [];
  for (const householdId of householdIds) {
    const summary = await reconcileHousehold(deps, householdId, windowStartIso, now);
    summaries.push(summary);
    await writeAudit(deps.supabase, {
      household_id: householdId,
      action: 'financial.reconciliation.completed',
      resource_id: householdId,
      after: {
        email_tx_considered: summary.emailTxConsidered,
        matches_linked: summary.matchesLinked,
        ambiguous_left: summary.ambiguousLeft,
        unmatched_left: summary.unmatchedLeft,
        window_start: windowStartIso,
      },
    });
  }

  deps.log.info('financial reconciliation complete', {
    households: summaries.length,
    total_matches: summaries.reduce((acc, s) => acc + s.matchesLinked, 0),
    total_ambiguous: summaries.reduce((acc, s) => acc + s.ambiguousLeft, 0),
  });

  return summaries;
}

async function reconcileHousehold(
  deps: ReconcilerDeps,
  householdId: string,
  windowStartIso: string,
  _now: Date,
): Promise<ReconciliationSummary> {
  const emailRows = await loadUnmatchedEmailTransactions(
    deps.supabase,
    householdId,
    windowStartIso,
  );
  if (emailRows.length === 0) {
    return {
      householdId,
      emailTxConsidered: 0,
      matchesLinked: 0,
      ambiguousLeft: 0,
      unmatchedLeft: 0,
    };
  }
  const providerRows = await loadProviderTransactions(deps.supabase, householdId, windowStartIso);

  let matches = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const email of emailRows) {
    const candidates = providerRows.filter((p) => isCandidate(email, p));
    const scored = candidates
      .map((p) => ({ row: p, score: merchantSimilarity(email.merchant_raw, p.merchant_raw) }))
      .filter((s) => s.score > MERCHANT_SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) {
      const match = scored[0]!;
      await linkMatch(deps, email, match.row);
      matches += 1;
      // Remove the matched provider row from further consideration so
      // a second email receipt doesn't also claim it.
      providerRows.splice(providerRows.indexOf(match.row), 1);
      continue;
    }
    if (scored.length > 1) {
      await markAmbiguous(
        deps,
        email,
        scored.map((s) => s.row.id),
      );
      ambiguous += 1;
      continue;
    }
    unmatched += 1;
  }

  return {
    householdId,
    emailTxConsidered: emailRows.length,
    matchesLinked: matches,
    ambiguousLeft: ambiguous,
    unmatchedLeft: unmatched,
  };
}

// ---- Candidate filter + merchant similarity ---------------------------

export function isCandidate(email: EmailTxRow, provider: ProviderTxRow): boolean {
  if (email.household_id !== provider.household_id) return false;
  if (Math.abs(email.amount_cents - provider.amount_cents) > AMOUNT_TOLERANCE_CENTS) return false;
  const emailTs = new Date(email.occurred_at).getTime();
  const provTs = new Date(provider.occurred_at).getTime();
  if (!Number.isFinite(emailTs) || !Number.isFinite(provTs)) return false;
  const diffDays = Math.abs(emailTs - provTs) / (24 * 60 * 60 * 1000);
  if (diffDays > DATE_TOLERANCE_DAYS) return false;
  return true;
}

/**
 * Jaro-Winkler similarity on normalized merchant strings. Returns a
 * value in [0, 1]. We hand-roll it to avoid an extra dependency —
 * textbook algorithm, short enough to be auditable.
 *
 * Normalization: case-folding, strip non-alphanumeric, collapse whitespace.
 * This is deliberately permissive so `"Blue Bottle Coffee #123"` matches
 * `"BLUE BOTTLE COFFEE"` — most merchant strings carry provider-added
 * location suffixes.
 */
export function merchantSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const aa = normalizeMerchant(a);
  const bb = normalizeMerchant(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  return jaroWinkler(aa, bb);
}

function normalizeMerchant(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jaro similarity (no Winkler prefix bonus). Score in [0, 1]. */
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array<boolean>(len1).fill(false);
  const s2Matches = new Array<boolean>(len2).fill(false);
  let matches = 0;

  for (let i = 0; i < len1; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j += 1) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i += 1) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k += 1;
    if (s1[i] !== s2[k]) transpositions += 1;
    k += 1;
  }
  transpositions = Math.floor(transpositions / 2);
  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
}

/** Jaro-Winkler. Adds a bonus for common-prefix matches up to 4 chars. */
function jaroWinkler(s1: string, s2: string): number {
  const base = jaro(s1, s2);
  if (base < 0.7) return base;
  const maxPrefix = 4;
  let prefix = 0;
  const upto = Math.min(maxPrefix, s1.length, s2.length);
  for (let i = 0; i < upto; i += 1) {
    if (s1[i] === s2[i]) prefix += 1;
    else break;
  }
  return base + prefix * 0.1 * (1 - base);
}

// ---- Supabase helpers --------------------------------------------------

async function listHouseholdsWithEmailTx(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('transaction')
    .select('household_id')
    .eq('source', EMAIL_RECEIPT_SOURCE)
    .limit(10_000);
  if (error) throw new Error(`household scan failed: ${error.message}`);
  const out = new Set<string>();
  for (const row of data ?? []) {
    if (row.household_id) out.add(row.household_id);
  }
  return [...out];
}

async function loadUnmatchedEmailTransactions(
  supabase: SupabaseClient<Database>,
  householdId: string,
  windowStartIso: string,
): Promise<EmailTxRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('transaction')
    .select('id, household_id, member_id, occurred_at, amount_cents, merchant_raw, metadata')
    .eq('household_id', householdId)
    .eq('source', EMAIL_RECEIPT_SOURCE)
    .gte('occurred_at', windowStartIso);
  if (error) throw new Error(`email tx lookup failed: ${error.message}`);
  const rows = (data ?? []) as EmailTxRow[];
  // Filter out rows that already have a match tagged. We do the filter
  // client-side so a missing `?` path in supabase-js doesn't produce a
  // silently-empty result.
  return rows.filter((r) => !readMatchedTransactionId(r.metadata));
}

async function loadProviderTransactions(
  supabase: SupabaseClient<Database>,
  householdId: string,
  windowStartIso: string,
): Promise<ProviderTxRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('transaction')
    .select('id, household_id, occurred_at, amount_cents, merchant_raw, source, metadata')
    .eq('household_id', householdId)
    .in('source', PROVIDER_SOURCES as unknown as string[])
    .gte('occurred_at', windowStartIso);
  if (error) throw new Error(`provider tx lookup failed: ${error.message}`);
  return (data ?? []) as ProviderTxRow[];
}

function readMatchedTransactionId(metadata: Json): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const raw = (metadata as Record<string, unknown>).matched_transaction_id;
  return typeof raw === 'string' ? raw : undefined;
}

async function linkMatch(
  deps: ReconcilerDeps,
  email: EmailTxRow,
  provider: ProviderTxRow,
): Promise<void> {
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const emailMeta = {
    ...(email.metadata && typeof email.metadata === 'object' && !Array.isArray(email.metadata)
      ? (email.metadata as Record<string, unknown>)
      : {}),
    matched_transaction_id: provider.id,
    status: 'shadowed',
  };
  const providerMeta = {
    ...(provider.metadata &&
    typeof provider.metadata === 'object' &&
    !Array.isArray(provider.metadata)
      ? (provider.metadata as Record<string, unknown>)
      : {}),
    email_receipt_id: email.id,
  };

  const { error: emailErr } = await deps.supabase
    .schema('app')
    .from('transaction')
    .update({ metadata: emailMeta as unknown as Json, updated_at: nowIso })
    .eq('id', email.id);
  if (emailErr) throw new Error(`email tx link failed: ${emailErr.message}`);
  const { error: providerErr } = await deps.supabase
    .schema('app')
    .from('transaction')
    .update({ metadata: providerMeta as unknown as Json, updated_at: nowIso })
    .eq('id', provider.id);
  if (providerErr) throw new Error(`provider tx link failed: ${providerErr.message}`);
}

async function markAmbiguous(
  deps: ReconcilerDeps,
  email: EmailTxRow,
  candidateIds: string[],
): Promise<void> {
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const meta = {
    ...(email.metadata && typeof email.metadata === 'object' && !Array.isArray(email.metadata)
      ? (email.metadata as Record<string, unknown>)
      : {}),
    status: 'ambiguous_match',
    candidate_transaction_ids: candidateIds,
  };
  const { error } = await deps.supabase
    .schema('app')
    .from('transaction')
    .update({ metadata: meta as unknown as Json, updated_at: nowIso })
    .eq('id', email.id);
  if (error) throw new Error(`ambiguous mark failed: ${error.message}`);
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
      resource_type: 'app.transaction',
      resource_id: input.resource_id,
      before: null,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[reconciler] audit write failed: ${error.message}`);
  }
}

/** Exposed for tests. */
export const __internal = { normalizeMerchant, jaroWinkler };
