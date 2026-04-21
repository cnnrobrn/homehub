/**
 * `listPersons` — household person directory.
 *
 * Reads `mem.node where type='person'` and enriches each row with:
 *   - pending alert count (from `app.alert` where
 *     `context.person_node_id` matches).
 *   - last-seen timestamp (from `mem.episode` where `participants`
 *     contains the person id).
 *
 * The helper is RLS-grant-aware: callers without `social:read` get an
 * empty array without a round trip. Soft-deleted nodes
 * (`metadata.deleted_at`) are filtered out.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasSocialRead, type PersonRow, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';


export const listPersonsArgsSchema = z.object({
  householdId: z.string().uuid(),
  searchText: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListPersonsArgs = z.infer<typeof listPersonsArgsSchema>;

export interface PersonListRow extends PersonRow {
  lastSeenAt: string | null;
  pendingAlertCount: number;
}

type NodeRowDb = Database['mem']['Tables']['node']['Row'];
type AppPersonRowDb = Database['app']['Tables']['person']['Row'];

function toCamel(row: NodeRowDb): PersonRow {
  const metadata =
    row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    householdId: row.household_id,
    canonicalName: row.canonical_name,
    needsReview: Boolean(row.needs_review),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    aliases: [],
    metadata,
    relationship:
      typeof metadata['relationship'] === 'string' ? (metadata['relationship'] as string) : null,
  };
}

export interface ListPersonsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listPersons(
  args: ListPersonsArgs,
  deps: ListPersonsDeps = {},
): Promise<PersonListRow[]> {
  const parsed = listPersonsArgsSchema.parse(args);
  if (deps.grants && !hasSocialRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('mem')
    .from('node')
    .select('id, household_id, canonical_name, needs_review, created_at, updated_at, metadata')
    .eq('household_id', parsed.householdId)
    .eq('type', 'person');
  if (parsed.searchText && parsed.searchText.length > 0) {
    query = query.ilike('canonical_name', `%${parsed.searchText}%`);
  }
  query = query.order('canonical_name', { ascending: true }).limit(parsed.limit ?? 200);

  const { data: nodeData, error: nodeErr } = await query;
  if (nodeErr) throw new Error(`listPersons: ${nodeErr.message}`);
  const people = ((nodeData ?? []) as NodeRowDb[])
    .filter((r) => {
      const m = (r.metadata as Record<string, unknown> | null) ?? {};
      return !(typeof m['deleted_at'] === 'string' && m['deleted_at'].length > 0);
    })
    .map(toCamel);

  if (people.length === 0) return [];

  const ids = people.map((p) => p.id);

  // Per-person aliases + relationship mirror from `app.person`.
  const [aliasRes, personRes, alertRes, episodeRes] = await Promise.all([
    client
      .schema('mem')
      .from('alias')
      .select('node_id, alias')
      .eq('household_id', parsed.householdId)
      .in('node_id', ids),
    client
      .schema('app')
      .from('person')
      .select('id, household_id, display_name, relationship, aliases, metadata')
      .eq('household_id', parsed.householdId)
      .in(
        'display_name',
        people.map((p) => p.canonicalName),
      ),
    client
      .schema('app')
      .from('alert')
      .select('id, context, dismissed_at')
      .eq('household_id', parsed.householdId)
      .eq('segment', 'social')
      .is('dismissed_at', null),
    client
      .schema('mem')
      .from('episode')
      .select('occurred_at, participants')
      .eq('household_id', parsed.householdId)
      .overlaps('participants', ids)
      .order('occurred_at', { ascending: false })
      .limit(500),
  ]);

  const aliasesByNode = new Map<string, string[]>();
  if (!aliasRes.error) {
    for (const r of (aliasRes.data ?? []) as Array<{ node_id: string; alias: string }>) {
      const list = aliasesByNode.get(r.node_id) ?? [];
      list.push(r.alias);
      aliasesByNode.set(r.node_id, list);
    }
  }

  const relationshipByName = new Map<string, string | null>();
  if (!personRes.error) {
    for (const r of (personRes.data ?? []) as AppPersonRowDb[]) {
      relationshipByName.set(r.display_name, r.relationship);
    }
  }

  const alertsByPerson = new Map<string, number>();
  if (!alertRes.error) {
    for (const row of alertRes.data ?? []) {
      const ctx = (row.context as Record<string, unknown> | null) ?? {};
      const pid = ctx['person_node_id'];
      if (typeof pid === 'string') {
        alertsByPerson.set(pid, (alertsByPerson.get(pid) ?? 0) + 1);
      }
    }
  }

  const lastSeenByPerson = new Map<string, string>();
  if (!episodeRes.error) {
    for (const row of episodeRes.data ?? []) {
      const participants = (row.participants as string[] | null) ?? [];
      const occurredAt = row.occurred_at as string;
      for (const pid of participants) {
        if (!ids.includes(pid)) continue;
        const prior = lastSeenByPerson.get(pid);
        if (!prior || prior.localeCompare(occurredAt) < 0) {
          lastSeenByPerson.set(pid, occurredAt);
        }
      }
    }
  }

  return people.map((p) => ({
    ...p,
    aliases: aliasesByNode.get(p.id) ?? [],
    relationship: p.relationship ?? relationshipByName.get(p.canonicalName) ?? null,
    lastSeenAt: lastSeenByPerson.get(p.id) ?? null,
    pendingAlertCount: alertsByPerson.get(p.id) ?? 0,
  }));
}
