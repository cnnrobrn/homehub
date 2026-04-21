/**
 * `listFunAlerts` — server-side reader for `app.alert` rows in the Fun
 * segment. Mirrors `listFinancialAlerts`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFunRead, type SegmentGrant } from './segmentGrants';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const FUN_ALERT_SEVERITIES = ['critical', 'warn', 'info'] as const;
export type FunAlertSeverity = (typeof FUN_ALERT_SEVERITIES)[number];

export const listFunAlertsArgsSchema = z.object({
  householdId: z.string().uuid(),
  includeDismissed: z.boolean().optional(),
  severities: z.array(z.enum(FUN_ALERT_SEVERITIES)).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListFunAlertsArgs = z.infer<typeof listFunAlertsArgsSchema>;

export interface FunAlertRow {
  id: string;
  householdId: string;
  segment: string;
  severity: FunAlertSeverity;
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

const SEVERITY_RANK: Record<FunAlertSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

function toCamel(row: AlertRowDb): FunAlertRow {
  const ctxRaw = row.context;
  const context =
    ctxRaw !== null && typeof ctxRaw === 'object' && !Array.isArray(ctxRaw)
      ? (ctxRaw as Record<string, unknown>)
      : {};
  const severity = (FUN_ALERT_SEVERITIES as readonly string[]).includes(row.severity)
    ? (row.severity as FunAlertSeverity)
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
    segment: row.segment,
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

export interface ListFunAlertsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFunAlerts(
  args: ListFunAlertsArgs,
  deps: ListFunAlertsDeps = {},
): Promise<FunAlertRow[]> {
  const parsed = listFunAlertsArgsSchema.parse(args);
  if (deps.grants && !hasFunRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('alert')
    .select(
      'id, household_id, segment, severity, title, body, generated_at, generated_by, dismissed_at, dismissed_by, context',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'fun');

  if (!parsed.includeDismissed) query = query.is('dismissed_at', null);
  if (parsed.severities && parsed.severities.length > 0) {
    query = query.in('severity', parsed.severities);
  }
  query = query.order('generated_at', { ascending: false }).limit(parsed.limit ?? 100);

  const { data, error } = await query;
  if (error) throw new Error(`listFunAlerts: ${error.message}`);
  const rows = (data ?? []).map((row) => toCamel(row as AlertRowDb));
  rows.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.generatedAt.localeCompare(a.generatedAt);
  });
  return rows;
}
