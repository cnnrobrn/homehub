/**
 * `listTrips` — server-side reader for parent trip events in the Fun
 * segment. Powers `/fun/trips`.
 *
 * A trip is an `app.event` row with `segment='fun'`, `kind='trip'`, and
 * `metadata.trip_id = event.id`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFunRead, type SegmentGrant } from './segmentGrants';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listTripsArgsSchema = z.object({
  householdId: z.string().uuid(),
  /** Include past trips. Default: false. */
  includePast: z.boolean().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export type ListTripsArgs = z.infer<typeof listTripsArgsSchema>;

export interface TripRow {
  id: string;
  householdId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  ownerMemberId: string | null;
  metadata: Record<string, unknown>;
}

type EventRowDb = Database['app']['Tables']['event']['Row'];

function toCamel(row: EventRowDb): TripRow {
  const metadata = row.metadata;
  const normalizedMeta =
    metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    householdId: row.household_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    ownerMemberId: row.owner_member_id,
    metadata: normalizedMeta,
  };
}

export interface ListTripsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listTrips(args: ListTripsArgs, deps: ListTripsDeps = {}): Promise<TripRow[]> {
  const parsed = listTripsArgsSchema.parse(args);
  if (deps.grants && !hasFunRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('event')
    .select(
      'id, household_id, segment, kind, title, starts_at, ends_at, all_day, location, provider, metadata, owner_member_id',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'fun')
    .eq('kind', 'trip');

  if (!parsed.includePast) {
    query = query.gte('ends_at', new Date().toISOString());
  }
  query = query.order('starts_at', { ascending: true }).limit(parsed.limit ?? 100);

  const { data, error } = await query;
  if (error) throw new Error(`listTrips: ${error.message}`);
  return (data ?? []).map((row) => toCamel(row as EventRowDb));
}
