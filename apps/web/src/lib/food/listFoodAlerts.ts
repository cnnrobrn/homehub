/**
 * `listFoodAlerts` — server-side reader for `app.alert where segment='food'`.
 *
 * Mirrors the financial alerts helper.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFoodRead, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const FOOD_ALERT_SEVERITIES = ['critical', 'warn', 'info'] as const;
export type FoodAlertSeverity = (typeof FOOD_ALERT_SEVERITIES)[number];

export const listFoodAlertsArgsSchema = z.object({
  householdId: z.string().uuid(),
  includeDismissed: z.boolean().optional(),
  severities: z.array(z.enum(FOOD_ALERT_SEVERITIES)).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListFoodAlertsArgs = z.infer<typeof listFoodAlertsArgsSchema>;

export interface FoodAlertRow {
  id: string;
  householdId: string;
  severity: FoodAlertSeverity;
  title: string;
  body: string;
  generatedAt: string;
  generatedBy: string;
  dismissedAt: string | null;
  dismissedBy: string | null;
  alertKind: string | null;
  alertDedupeKey: string | null;
  context: Record<string, unknown>;
}

type AlertRowDb = Database['app']['Tables']['alert']['Row'];

const RANK: Record<FoodAlertSeverity, number> = { critical: 0, warn: 1, info: 2 };

function toCamel(row: AlertRowDb): FoodAlertRow {
  const ctxRaw = row.context;
  const context =
    ctxRaw !== null && typeof ctxRaw === 'object' && !Array.isArray(ctxRaw)
      ? (ctxRaw as Record<string, unknown>)
      : {};
  const severity = (FOOD_ALERT_SEVERITIES as readonly string[]).includes(row.severity)
    ? (row.severity as FoodAlertSeverity)
    : 'info';
  const alertKind =
    typeof context['alert_kind'] === 'string' ? (context['alert_kind'] as string) : null;
  const alertDedupeKey =
    typeof context['alert_dedupe_key'] === 'string'
      ? (context['alert_dedupe_key'] as string)
      : null;
  return {
    id: row.id,
    householdId: row.household_id,
    severity,
    title: row.title,
    body: row.body,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    dismissedAt: row.dismissed_at,
    dismissedBy: row.dismissed_by,
    alertKind,
    alertDedupeKey,
    context,
  };
}

export interface ListFoodAlertsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFoodAlerts(
  args: ListFoodAlertsArgs,
  deps: ListFoodAlertsDeps = {},
): Promise<FoodAlertRow[]> {
  const parsed = listFoodAlertsArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) return [];
  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('alert')
    .select(
      'id, household_id, segment, severity, title, body, generated_at, generated_by, dismissed_at, dismissed_by, context',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'food');
  if (!parsed.includeDismissed) {
    query = query.is('dismissed_at', null);
  }
  if (parsed.severities && parsed.severities.length > 0) {
    query = query.in('severity', parsed.severities);
  }
  query = query.order('generated_at', { ascending: false }).limit(parsed.limit ?? 100);
  const { data, error } = await query;
  if (error) throw new Error(`listFoodAlerts: ${error.message}`);
  const rows = (data ?? []).map((r) => toCamel(r as AlertRowDb));
  rows.sort((a, b) => {
    const diff = RANK[a.severity] - RANK[b.severity];
    if (diff !== 0) return diff;
    return b.generatedAt.localeCompare(a.generatedAt);
  });
  return rows;
}
