/**
 * `listSocialAlerts` — reader for `app.alert` rows filtered to
 * `segment='social'`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasSocialRead, type SegmentGrant, type SocialAlertRow } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const ALERT_SEVERITIES = ['critical', 'warn', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const listSocialAlertsArgsSchema = z.object({
  householdId: z.string().uuid(),
  includeDismissed: z.boolean().optional(),
  severities: z.array(z.enum(ALERT_SEVERITIES)).optional(),
  personNodeId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListSocialAlertsArgs = z.infer<typeof listSocialAlertsArgsSchema>;

type AlertRowDb = Database['app']['Tables']['alert']['Row'];

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

function toCamel(row: AlertRowDb): SocialAlertRow {
  const ctx =
    row.context !== null && typeof row.context === 'object' && !Array.isArray(row.context)
      ? (row.context as Record<string, unknown>)
      : {};
  const severity = (ALERT_SEVERITIES as readonly string[]).includes(row.severity)
    ? (row.severity as AlertSeverity)
    : 'info';
  return {
    id: row.id,
    householdId: row.household_id,
    severity,
    title: row.title,
    body: row.body,
    generatedAt: row.generated_at,
    dismissedAt: row.dismissed_at,
    alertKind: typeof ctx['alert_kind'] === 'string' ? (ctx['alert_kind'] as string) : null,
    alertDedupeKey:
      typeof ctx['alert_dedupe_key'] === 'string' ? (ctx['alert_dedupe_key'] as string) : null,
    context: ctx,
  };
}

export interface ListSocialAlertsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listSocialAlerts(
  args: ListSocialAlertsArgs,
  deps: ListSocialAlertsDeps = {},
): Promise<SocialAlertRow[]> {
  const parsed = listSocialAlertsArgsSchema.parse(args);
  if (deps.grants && !hasSocialRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('alert')
    .select(
      'id, household_id, segment, severity, title, body, generated_at, generated_by, dismissed_at, dismissed_by, context',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'social');

  if (!parsed.includeDismissed) query = query.is('dismissed_at', null);
  if (parsed.severities && parsed.severities.length > 0) {
    query = query.in('severity', parsed.severities);
  }
  query = query.order('generated_at', { ascending: false }).limit(parsed.limit ?? 100);

  const { data, error } = await query;
  if (error) throw new Error(`listSocialAlerts: ${error.message}`);
  let rows = (data ?? []).map((r) => toCamel(r as AlertRowDb));

  if (parsed.personNodeId) {
    rows = rows.filter((r) => r.context['person_node_id'] === parsed.personNodeId);
  }

  rows.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    return b.generatedAt.localeCompare(a.generatedAt);
  });
  return rows;
}
