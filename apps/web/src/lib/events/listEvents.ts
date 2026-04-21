/**
 * `listEvents` — server-side reader for `app.event`.
 *
 * The single "unified calendar" helper the web app uses for the dashboard
 * Today strip, the `/calendar` page, and (later) per-segment calendar
 * pages. Always runs under the authed, RLS-enforced Supabase client so
 * Postgres is the last line of defense; the helper additionally trims the
 * caller's segment filter to the segments they actually have read access
 * to, which both short-circuits unnecessary queries and keeps UI state
 * (e.g. the segment filter checkboxes) honest.
 *
 * The time-window query is intentionally inclusive of "point in time"
 * events (events with `ends_at IS NULL`). For those we treat the start
 * as the effective end and only include them when they fall inside the
 * window. For bounded events we include anything that overlaps.
 *
 * Rows come back as camelCase to match the rest of the web app's
 * convention; callers should never see raw snake_case column names.
 */

import { type Database } from '@homehub/db';
import { SEGMENTS, type CalendarEventRow, type Segment } from '@homehub/shared';
import { z } from 'zod';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export { SEGMENTS, type CalendarEventRow, type Segment };

const isoDateTime = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
  message: 'must be a valid ISO-8601 date-time',
});

export const listEventsArgsSchema = z.object({
  householdId: z.string().uuid(),
  from: isoDateTime,
  to: isoDateTime,
  segments: z.array(z.enum(SEGMENTS)).optional(),
  limit: z.number().int().positive().max(2_000).optional(),
});

export type ListEventsArgs = z.infer<typeof listEventsArgsSchema>;

export interface SegmentGrant {
  segment: Segment;
  access: 'none' | 'read' | 'write';
}

/**
 * Intersect caller-supplied segment filter with the segments the member
 * can actually read. Returns the allow-list — callers that want "all
 * readable" can omit `requested`.
 *
 * A grant of `'none'` (or absent) means no read access; both `'read'`
 * and `'write'` imply read. This mirrors `app.member_segment_grant` and
 * the RLS policies in `specs/02-data-model/row-level-security.md`.
 */
export function allowedSegments(
  grants: readonly SegmentGrant[],
  requested?: readonly Segment[],
): Segment[] {
  const readable = new Set<Segment>();
  for (const g of grants) {
    if (g.access === 'read' || g.access === 'write') {
      readable.add(g.segment);
    }
  }
  if (!requested) return [...readable];
  return requested.filter((s) => readable.has(s));
}

type EventRow = Database['app']['Tables']['event']['Row'];

function toCamel(row: EventRow): CalendarEventRow {
  const metadata = row.metadata;
  const normalizedMeta =
    metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    householdId: row.household_id,
    segment: row.segment as Segment,
    kind: row.kind,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    location: row.location,
    provider: row.provider,
    ownerMemberId: row.owner_member_id,
    metadata: normalizedMeta,
  };
}

export interface ListEventsDeps {
  /**
   * Optional injected client for tests. In production this is left
   * undefined and the module lazily constructs a request-scoped
   * `ServerSupabaseClient`.
   */
  client?: ServerSupabaseClient;
  /**
   * Optional segment grants (from `getHouseholdContext()`) to intersect
   * with `args.segments`. When omitted, the server client's RLS alone
   * decides visibility — passing grants is a perf nicety (avoids a
   * pointless filter list) and lets the UI hide controls for segments
   * the member can't read.
   */
  grants?: readonly SegmentGrant[];
}

const DEFAULT_LIMIT = 500;

export async function listEvents(
  args: ListEventsArgs,
  deps: ListEventsDeps = {},
): Promise<CalendarEventRow[]> {
  const parsed = listEventsArgsSchema.parse(args);
  if (new Date(parsed.to).getTime() <= new Date(parsed.from).getTime()) {
    // Caller bug — log-worthy but return an empty list rather than
    // throw. A `/calendar?cursor=…` with a degenerate window should
    // paint an empty grid, not a 500.
    return [];
  }

  const client = deps.client ?? (await createClient());
  const segmentsFilter = deps.grants
    ? allowedSegments(deps.grants, parsed.segments)
    : parsed.segments;

  // If grants were passed and the intersection is empty, return early —
  // the DB would return nothing anyway, but skipping the round trip is
  // cheaper and lets the UI differentiate "no access" from "no events."
  if (segmentsFilter && segmentsFilter.length === 0) {
    return [];
  }

  let query = client
    .schema('app')
    .from('event')
    .select(
      'id, household_id, owner_member_id, segment, kind, title, starts_at, ends_at, all_day, location, provider, metadata',
    )
    .eq('household_id', parsed.householdId)
    // Starts before window end — excludes events that haven't started yet.
    .lt('starts_at', parsed.to);

  // Bounded events: ends after window start.
  // Point-in-time events (ends_at IS NULL): starts on or after window start.
  // PostgREST `or()` lets us express this in a single server-side filter.
  query = query.or(`ends_at.gt.${parsed.from},and(ends_at.is.null,starts_at.gte.${parsed.from})`);

  if (segmentsFilter && segmentsFilter.length > 0) {
    query = query.in('segment', segmentsFilter);
  }

  query = query.order('starts_at', { ascending: true }).limit(parsed.limit ?? DEFAULT_LIMIT);

  const { data, error } = await query;
  if (error) {
    throw new Error(`listEvents: ${error.message}`);
  }
  return (data ?? []).map((row) => toCamel(row as EventRow));
}
