/**
 * Server helpers for the unified `/suggestions` page.
 *
 * These run on the Server Component path (RLS-bypassing service-role
 * client is NOT used; we use the authed SSR client so reads are still
 * filtered by the household-scoped RLS policies). The suggestions page
 * layers grant-based filtering in the component: RLS already scopes to
 * the household, and segment-level visibility is enforced by the
 * member_segment_grant policy on `app.suggestion`.
 *
 * The policy/quorum columns are computed by merging the row's
 * `approvers` column (JSONB, when present) with the `preview.__approvers`
 * fallback used by the approval-flow state machine. Both shapes are
 * tolerated because migration 0014 ships the column but pre-migration
 * environments still stash approvers in the preview.
 */

import { extractApprovers, getPolicyFor } from '@homehub/approval-flow';
import { type Database } from '@homehub/db';
import { z } from 'zod';

import {
  type SuggestionApproverView,
  type SuggestionDetailView,
  type SuggestionRowView,
} from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

type SuggestionRowDb = Database['app']['Tables']['suggestion']['Row'];
type ActionRowDb = Database['app']['Tables']['action']['Row'];
type MemberRowDb = Database['app']['Tables']['member']['Row'];
type AlertRowDb = Database['app']['Tables']['alert']['Row'];

export const listPendingSuggestionsArgsSchema = z.object({
  householdId: z.string().uuid(),
  segment: z.enum(['financial', 'food', 'fun', 'social', 'system']).optional(),
  kind: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type ListPendingSuggestionsArgs = z.input<typeof listPendingSuggestionsArgsSchema>;

export const listRecentSuggestionsArgsSchema = z.object({
  householdId: z.string().uuid(),
  status: z.enum(['approved', 'rejected', 'executed', 'expired']),
  limit: z.number().int().positive().max(100).optional(),
});

export type ListRecentSuggestionsArgs = z.input<typeof listRecentSuggestionsArgsSchema>;

export const getSuggestionDetailArgsSchema = z.object({
  householdId: z.string().uuid(),
  suggestionId: z.string().uuid(),
});

export type GetSuggestionDetailArgs = z.input<typeof getSuggestionDetailArgsSchema>;

interface ListSuggestionsDeps {
  client?: ServerSupabaseClient;
}

function previewAsRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function toMemberLookup(
  rows: readonly Pick<MemberRowDb, 'id' | 'display_name'>[],
): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const r of rows) m.set(r.id, r.display_name);
  return m;
}

function rowToView(
  row: SuggestionRowDb,
  memberNames: Map<string, string | null>,
): SuggestionRowView {
  const preview = previewAsRecord(row.preview);
  const approvers = extractApprovers(row as unknown as Parameters<typeof extractApprovers>[0]).map(
    (a): SuggestionApproverView => ({
      memberId: a.memberId,
      memberName: a.memberId ? (memberNames.get(a.memberId) ?? null) : null,
      approvedAt: a.approvedAt,
    }),
  );
  const policy = getPolicyFor(row.kind);
  return {
    id: row.id,
    householdId: row.household_id,
    segment: row.segment,
    kind: row.kind,
    title: row.title,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByMemberId: row.resolved_by,
    resolvedByMemberName: row.resolved_by ? (memberNames.get(row.resolved_by) ?? null) : null,
    preview,
    approvers,
    quorumMet: approvers.length >= policy.requiresQuorum,
    requiresQuorum: policy.requiresQuorum,
  };
}

async function loadMemberNames(
  client: ServerSupabaseClient,
  householdId: string,
): Promise<Map<string, string | null>> {
  const { data, error } = await client
    .schema('app')
    .from('member')
    .select('id, display_name')
    .eq('household_id', householdId);
  if (error) throw new Error(`listSuggestions: member lookup: ${error.message}`);
  return toMemberLookup((data ?? []) as Array<Pick<MemberRowDb, 'id' | 'display_name'>>);
}

export async function listPendingSuggestions(
  args: ListPendingSuggestionsArgs,
  deps: ListSuggestionsDeps = {},
): Promise<SuggestionRowView[]> {
  const parsed = listPendingSuggestionsArgsSchema.parse(args);
  const client = deps.client ?? (await createClient());

  let query = client
    .schema('app')
    .from('suggestion')
    .select('*')
    .eq('household_id', parsed.householdId)
    .eq('status', 'pending');

  if (parsed.segment) query = query.eq('segment', parsed.segment);
  if (parsed.kind) query = query.eq('kind', parsed.kind);
  query = query.order('created_at', { ascending: false }).limit(parsed.limit ?? 50);

  const { data, error } = await query;
  if (error) throw new Error(`listPendingSuggestions: ${error.message}`);

  const rows = (data ?? []) as SuggestionRowDb[];
  if (rows.length === 0) return [];
  const memberNames = await loadMemberNames(client, parsed.householdId);
  return rows.map((r) => rowToView(r, memberNames));
}

export async function listRecentSuggestions(
  args: ListRecentSuggestionsArgs,
  deps: ListSuggestionsDeps = {},
): Promise<SuggestionRowView[]> {
  const parsed = listRecentSuggestionsArgsSchema.parse(args);
  const client = deps.client ?? (await createClient());

  const { data, error } = await client
    .schema('app')
    .from('suggestion')
    .select('*')
    .eq('household_id', parsed.householdId)
    .eq('status', parsed.status)
    .order('resolved_at', { ascending: false, nullsFirst: false })
    .limit(parsed.limit ?? 25);

  if (error) throw new Error(`listRecentSuggestions: ${error.message}`);
  const rows = (data ?? []) as SuggestionRowDb[];
  if (rows.length === 0) return [];
  const memberNames = await loadMemberNames(client, parsed.householdId);
  return rows.map((r) => rowToView(r, memberNames));
}

export async function getSuggestionDetail(
  args: GetSuggestionDetailArgs,
  deps: ListSuggestionsDeps = {},
): Promise<SuggestionDetailView | null> {
  const parsed = getSuggestionDetailArgsSchema.parse(args);
  const client = deps.client ?? (await createClient());

  const { data: sugRow, error: sugErr } = await client
    .schema('app')
    .from('suggestion')
    .select('*')
    .eq('household_id', parsed.householdId)
    .eq('id', parsed.suggestionId)
    .maybeSingle();
  if (sugErr) throw new Error(`getSuggestionDetail: ${sugErr.message}`);
  if (!sugRow) return null;
  const row = sugRow as SuggestionRowDb;

  const memberNames = await loadMemberNames(client, parsed.householdId);
  const base = rowToView(row, memberNames);

  // Action row (if any).
  const { data: actionRow, error: actionErr } = await client
    .schema('app')
    .from('action')
    .select('id, status, started_at, finished_at, error')
    .eq('household_id', parsed.householdId)
    .eq('suggestion_id', parsed.suggestionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (actionErr) {
    // Non-fatal — an action row may not exist yet. Log and keep going.

    console.warn('getSuggestionDetail: action lookup failed', actionErr.message);
  }

  // Alert context: if `preview.source_alert_id` is set, surface that.
  const preview = base.preview;
  const sourceAlertId =
    typeof preview.source_alert_id === 'string' ? preview.source_alert_id : null;
  let alertContext: Record<string, unknown> | null = null;
  if (sourceAlertId) {
    const { data: alertRow } = await client
      .schema('app')
      .from('alert')
      .select('id, title, body, context')
      .eq('household_id', parsed.householdId)
      .eq('id', sourceAlertId)
      .maybeSingle();
    if (alertRow) {
      const ar = alertRow as Pick<AlertRowDb, 'id' | 'title' | 'body' | 'context'>;
      alertContext = {
        id: ar.id,
        title: ar.title,
        body: ar.body,
        context: previewAsRecord(ar.context),
      };
    }
  }

  // Preview.evidence (if the generator stashed any) → evidence list.
  const rawEvidence = preview.evidence;
  const evidence =
    Array.isArray(rawEvidence) && rawEvidence.every((e) => typeof e === 'object' && e !== null)
      ? (rawEvidence as Array<Record<string, unknown>>)
      : [];

  return {
    ...base,
    action: actionRow
      ? {
          id: (actionRow as ActionRowDb).id,
          status: (actionRow as ActionRowDb).status,
          startedAt: (actionRow as ActionRowDb).started_at,
          finishedAt: (actionRow as ActionRowDb).finished_at,
          error: (actionRow as ActionRowDb).error,
        }
      : null,
    alertContext,
    evidence,
  };
}
