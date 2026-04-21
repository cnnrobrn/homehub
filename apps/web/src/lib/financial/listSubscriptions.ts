/**
 * `listSubscriptions` — server-side reader for `mem.node` rows of
 * `type='subscription'`.
 *
 * M5-B's subscription detector writes a node per detected recurring
 * charge, with `metadata.cadence` (monthly|yearly|weekly|etc.),
 * `metadata.price_cents`, `metadata.match_count`, and
 * `metadata.latest_transaction_id`. This helper surfaces those in
 * `/financial/subscriptions` and the Financial-dashboard "Upcoming
 * autopays" strip.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFinancialRead, type SegmentGrant } from './listTransactions';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listSubscriptionsArgsSchema = z.object({
  householdId: z.string().uuid(),
  needsReviewOnly: z.boolean().optional(),
});

export type ListSubscriptionsArgs = z.infer<typeof listSubscriptionsArgsSchema>;

export type SubscriptionCadence =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'unknown';

export interface SubscriptionRow {
  id: string;
  householdId: string;
  canonicalName: string;
  cadence: SubscriptionCadence;
  priceCents: number | null;
  currency: string;
  matchCount: number;
  latestTransactionId: string | null;
  lastChargedAt: string | null;
  nextChargeAt: string | null;
  needsReview: boolean;
  metadata: Record<string, unknown>;
}

type NodeRowDb = Database['mem']['Tables']['node']['Row'];

const CADENCES: SubscriptionCadence[] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'unknown',
];

function parseCadence(raw: unknown): SubscriptionCadence {
  return typeof raw === 'string' && (CADENCES as string[]).includes(raw)
    ? (raw as SubscriptionCadence)
    : 'unknown';
}

function parseInt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return null;
}

function addCadence(from: Date, cadence: SubscriptionCadence): Date | null {
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  switch (cadence) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      return d;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      return d;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      return d;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      return d;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      return d;
    case 'unknown':
    default:
      return null;
  }
}

function toCamel(row: NodeRowDb): SubscriptionRow {
  const meta =
    row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  const cadence = parseCadence(meta['cadence']);
  const priceCents = parseInt(meta['price_cents']);
  const matchCount = parseInt(meta['match_count']) ?? 0;
  const latestTransactionId =
    typeof meta['latest_transaction_id'] === 'string'
      ? (meta['latest_transaction_id'] as string)
      : null;
  const lastChargedAt =
    typeof meta['last_charged_at'] === 'string' ? (meta['last_charged_at'] as string) : null;
  const currency = typeof meta['currency'] === 'string' ? (meta['currency'] as string) : 'USD';

  const nextChargeAt = lastChargedAt
    ? (() => {
        const next = addCadence(new Date(lastChargedAt), cadence);
        return next ? next.toISOString() : null;
      })()
    : null;

  return {
    id: row.id,
    householdId: row.household_id,
    canonicalName: row.canonical_name,
    cadence,
    priceCents,
    currency,
    matchCount,
    latestTransactionId,
    lastChargedAt,
    nextChargeAt,
    needsReview: row.needs_review,
    metadata: meta,
  };
}

export interface ListSubscriptionsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listSubscriptions(
  args: ListSubscriptionsArgs,
  deps: ListSubscriptionsDeps = {},
): Promise<SubscriptionRow[]> {
  const parsed = listSubscriptionsArgsSchema.parse(args);

  if (deps.grants && !hasFinancialRead(deps.grants)) {
    return [];
  }

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('mem')
    .from('node')
    .select(
      'id, household_id, canonical_name, type, needs_review, metadata, created_at, updated_at',
    )
    .eq('household_id', parsed.householdId)
    .eq('type', 'subscription');

  if (parsed.needsReviewOnly) {
    query = query.eq('needs_review', true);
  }

  query = query.order('canonical_name', { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(`listSubscriptions: ${error.message}`);
  return (data ?? []).map((row) => toCamel(row as NodeRowDb));
}
