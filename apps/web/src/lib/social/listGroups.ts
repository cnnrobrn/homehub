/**
 * `listGroups` / `getGroupDetail` — group nodes + their members.
 *
 * Groups are `mem.node type='group'` (requires migration 0014_social.sql).
 * Until the migration lands, callers may see zero rows — the helpers
 * gracefully degrade because the type filter simply returns nothing.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasSocialRead, type GroupRow, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';


export const listGroupsArgsSchema = z.object({
  householdId: z.string().uuid(),
  limit: z.number().int().positive().max(200).optional(),
});

export const getGroupDetailArgsSchema = z.object({
  householdId: z.string().uuid(),
  groupNodeId: z.string().uuid(),
});

type NodeRowDb = Database['mem']['Tables']['node']['Row'];
type EdgeRowDb = Database['mem']['Tables']['edge']['Row'];

export interface GroupListRow extends GroupRow {
  memberCount: number;
}

export interface GroupDetail {
  group: GroupRow;
  members: Array<{
    id: string;
    canonicalName: string;
  }>;
  upcomingEventCount: number;
}

export interface ListGroupsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

function toGroup(row: NodeRowDb, memberIds: string[]): GroupRow {
  const metadata =
    row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    householdId: row.household_id,
    canonicalName: row.canonical_name,
    memberNodeIds: memberIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata,
  };
}

export async function listGroups(
  args: z.input<typeof listGroupsArgsSchema>,
  deps: ListGroupsDeps = {},
): Promise<GroupListRow[]> {
  const parsed = listGroupsArgsSchema.parse(args);
  if (deps.grants && !hasSocialRead(deps.grants)) return [];
  const client = deps.client ?? (await createClient());
  const { data, error } = await client
    .schema('mem')
    .from('node')
    .select('id, household_id, canonical_name, metadata, created_at, updated_at')
    .eq('household_id', parsed.householdId)
    .eq('type', 'group')
    .order('canonical_name', { ascending: true })
    .limit(parsed.limit ?? 100);
  if (error) return [];
  const groups = ((data ?? []) as NodeRowDb[]).filter((r) => {
    const m = (r.metadata as Record<string, unknown> | null) ?? {};
    return !(typeof m['deleted_at'] === 'string' && m['deleted_at'].length > 0);
  });
  if (groups.length === 0) return [];

  const { data: edges, error: edgeErr } = await client
    .schema('mem')
    .from('edge')
    .select('src_id, dst_id, type')
    .eq('household_id', parsed.householdId)
    .eq('type', 'part_of')
    .in(
      'dst_id',
      groups.map((g) => g.id),
    );
  const memberIdsByGroup = new Map<string, string[]>();
  if (!edgeErr) {
    for (const e of (edges ?? []) as EdgeRowDb[]) {
      const list = memberIdsByGroup.get(e.dst_id) ?? [];
      list.push(e.src_id);
      memberIdsByGroup.set(e.dst_id, list);
    }
  }

  return groups.map((g) => {
    const members = memberIdsByGroup.get(g.id) ?? [];
    return { ...toGroup(g, members), memberCount: members.length };
  });
}

export interface GetGroupDetailDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function getGroupDetail(
  args: z.input<typeof getGroupDetailArgsSchema>,
  deps: GetGroupDetailDeps = {},
): Promise<GroupDetail | null> {
  const parsed = getGroupDetailArgsSchema.parse(args);
  if (deps.grants && !hasSocialRead(deps.grants)) return null;
  const client = deps.client ?? (await createClient());
  const { data: nodeRow, error: nodeErr } = await client
    .schema('mem')
    .from('node')
    .select('*')
    .eq('id', parsed.groupNodeId)
    .eq('household_id', parsed.householdId)
    .eq('type', 'group')
    .maybeSingle();
  if (nodeErr) throw new Error(`getGroupDetail: ${nodeErr.message}`);
  if (!nodeRow) return null;
  const group = nodeRow as NodeRowDb;

  const [edgeRes, eventRes] = await Promise.all([
    client
      .schema('mem')
      .from('edge')
      .select('src_id, dst_id, type')
      .eq('household_id', parsed.householdId)
      .eq('type', 'part_of')
      .eq('dst_id', parsed.groupNodeId),
    client
      .schema('app')
      .from('event')
      .select('id, metadata, starts_at')
      .eq('household_id', parsed.householdId)
      .eq('segment', 'social')
      .gte('starts_at', new Date().toISOString()),
  ]);

  const memberIds = ((edgeRes.data ?? []) as EdgeRowDb[]).map((e) => e.src_id);
  const memberDetails: Array<{ id: string; canonicalName: string }> = [];
  if (memberIds.length > 0) {
    const { data: memberNodes, error: memberErr } = await client
      .schema('mem')
      .from('node')
      .select('id, canonical_name')
      .eq('household_id', parsed.householdId)
      .in('id', memberIds);
    if (!memberErr) {
      for (const r of (memberNodes ?? []) as Array<{ id: string; canonical_name: string }>) {
        memberDetails.push({ id: r.id, canonicalName: r.canonical_name });
      }
    }
  }

  let upcomingEventCount = 0;
  for (const e of eventRes.data ?? []) {
    const meta = (e.metadata as Record<string, unknown> | null) ?? {};
    if (meta['group_node_id'] === parsed.groupNodeId) upcomingEventCount += 1;
  }

  return {
    group: toGroup(group, memberIds),
    members: memberDetails,
    upcomingEventCount,
  };
}
