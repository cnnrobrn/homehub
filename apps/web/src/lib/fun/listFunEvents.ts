/**
 * `listFunEvents` — server-side reader for fun-segment `app.event` rows.
 *
 * Powers the Fun calendar + trip detail pages. Filters to `segment='fun'`
 * and optionally scopes to a trip (`metadata.trip_id = ?`).
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFunRead, type SegmentGrant } from './segmentGrants';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

const isoDateTime = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
  message: 'must be a valid ISO-8601 date-time',
});

export const listFunEventsArgsSchema = z.object({
  householdId: z.string().uuid(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  tripId: z.string().uuid().optional(),
  /** Exclude the parent trip event itself. Default false. */
  excludeTripParents: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListFunEventsArgs = z.infer<typeof listFunEventsArgsSchema>;

export interface FunEventRow {
  id: string;
  householdId: string;
  segment: string;
  kind: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  provider: string | null;
  ownerMemberId: string | null;
  tripId: string | null;
  metadata: Record<string, unknown>;
}

type EventRowDb = Database['app']['Tables']['event']['Row'];

function toCamel(row: EventRowDb): FunEventRow {
  const metadata = row.metadata;
  const normalizedMeta =
    metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    householdId: row.household_id,
    segment: row.segment,
    kind: row.kind,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    location: row.location,
    provider: row.provider,
    ownerMemberId: row.owner_member_id,
    tripId: typeof normalizedMeta.trip_id === 'string' ? (normalizedMeta.trip_id as string) : null,
    metadata: normalizedMeta,
  };
}

export interface ListFunEventsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFunEvents(
  args: ListFunEventsArgs,
  deps: ListFunEventsDeps = {},
): Promise<FunEventRow[]> {
  const parsed = listFunEventsArgsSchema.parse(args);
  if (deps.grants && !hasFunRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('event')
    .select(
      'id, household_id, segment, kind, title, starts_at, ends_at, all_day, location, provider, metadata, owner_member_id',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'fun');

  if (parsed.from) query = query.gte('starts_at', parsed.from);
  if (parsed.to) query = query.lt('starts_at', parsed.to);
  if (parsed.tripId) {
    // Parent + children — we want every event whose metadata.trip_id
    // equals the requested id. PostgREST's `jsonb ->> field` operator
    // exposes this filter.
    query = query.eq('metadata->>trip_id', parsed.tripId);
  }
  if (parsed.excludeTripParents) query = query.neq('kind', 'trip');
  query = query.order('starts_at', { ascending: true }).limit(parsed.limit ?? 200);

  const { data, error } = await query;
  if (error) throw new Error(`listFunEvents: ${error.message}`);
  return (data ?? []).map((row) => toCamel(row as EventRowDb));
}
