/**
 * `listFinancialAlerts` — server-side reader for `app.alert` rows in the
 * Financial segment.
 *
 * Powers `/financial/alerts` and the dashboard's Active Alerts bar. The
 * helper filters to `segment='financial'` + `dismissed_at IS NULL` by
 * default and orders by severity (critical > warn > info) then by
 * generated_at desc.
 *
 * `context.alert_kind` and `context.alert_dedupe_key` are surfaced on the
 * result so the alerts-feed UI can group related alerts.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFinancialRead, type SegmentGrant } from './listTransactions';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const ALERT_SEVERITIES = ['critical', 'warn', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const listFinancialAlertsArgsSchema = z.object({
  householdId: z.string().uuid(),
  includeDismissed: z.boolean().optional(),
  severities: z.array(z.enum(ALERT_SEVERITIES)).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListFinancialAlertsArgs = z.infer<typeof listFinancialAlertsArgsSchema>;

export interface FinancialAlertRow {
  id: string;
  householdId: string;
  segment: string;
  severity: AlertSeverity;
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

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

function toCamel(row: AlertRowDb): FinancialAlertRow {
  const ctxRaw = row.context;
  const context =
    ctxRaw !== null && typeof ctxRaw === 'object' && !Array.isArray(ctxRaw)
      ? (ctxRaw as Record<string, unknown>)
      : {};
  const severity = (ALERT_SEVERITIES as readonly string[]).includes(row.severity)
    ? (row.severity as AlertSeverity)
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

export interface ListFinancialAlertsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFinancialAlerts(
  args: ListFinancialAlertsArgs,
  deps: ListFinancialAlertsDeps = {},
): Promise<FinancialAlertRow[]> {
  const parsed = listFinancialAlertsArgsSchema.parse(args);

  if (deps.grants && !hasFinancialRead(deps.grants)) {
    return [];
  }

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('alert')
    .select(
      'id, household_id, segment, severity, title, body, generated_at, generated_by, dismissed_at, dismissed_by, context',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'financial');

  if (!parsed.includeDismissed) {
    query = query.is('dismissed_at', null);
  }

  if (parsed.severities && parsed.severities.length > 0) {
    query = query.in('severity', parsed.severities);
  }

  query = query.order('generated_at', { ascending: false }).limit(parsed.limit ?? 100);

  const { data, error } = await query;
  if (error) throw new Error(`listFinancialAlerts: ${error.message}`);
  const rows = (data ?? []).map((row) => toCamel(row as AlertRowDb));
  // Stable sort by severity rank first, then generated_at desc.
  rows.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.generatedAt.localeCompare(a.generatedAt);
  });
  return rows;
}
