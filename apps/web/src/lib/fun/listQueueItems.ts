/**
 * `listQueueItems` — member-curated "books / shows / games to do" list.
 *
 * Backed by `mem.node type='topic'` with `metadata.category='queue_item'`.
 * The member UI creates them via `createQueueItemAction`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFunRead, type SegmentGrant } from './segmentGrants';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const QUEUE_ITEM_CATEGORY = 'queue_item';

export const listQueueItemsArgsSchema = z.object({
  householdId: z.string().uuid(),
  /** Optional sub-category: "book", "show", "game". */
  subcategory: z.string().min(1).max(40).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListQueueItemsArgs = z.infer<typeof listQueueItemsArgsSchema>;

export interface QueueItemRow {
  id: string;
  householdId: string;
  title: string;
  subcategory: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

type NodeRowDb = Database['mem']['Tables']['node']['Row'];

function toCamel(row: NodeRowDb): QueueItemRow {
  const metadata = row.metadata;
  const normalizedMeta =
    metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const subcategory =
    typeof normalizedMeta.subcategory === 'string' ? (normalizedMeta.subcategory as string) : null;
  return {
    id: row.id,
    householdId: row.household_id,
    title: row.canonical_name,
    subcategory,
    createdAt: row.created_at,
    metadata: normalizedMeta,
  };
}

export interface ListQueueItemsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listQueueItems(
  args: ListQueueItemsArgs,
  deps: ListQueueItemsDeps = {},
): Promise<QueueItemRow[]> {
  const parsed = listQueueItemsArgsSchema.parse(args);
  if (deps.grants && !hasFunRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('mem')
    .from('node')
    .select('id, household_id, type, canonical_name, metadata, created_at, needs_review')
    .eq('household_id', parsed.householdId)
    .eq('type', 'topic')
    .eq('metadata->>category', QUEUE_ITEM_CATEGORY);
  if (parsed.subcategory) {
    query = query.eq('metadata->>subcategory', parsed.subcategory);
  }
  query = query.order('created_at', { ascending: false }).limit(parsed.limit ?? 200);

  const { data, error } = await query;
  if (error) throw new Error(`listQueueItems: ${error.message}`);
  return (data ?? []).map((row) => toCamel(row as NodeRowDb));
}
