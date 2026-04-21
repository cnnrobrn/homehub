/**
 * `list_events` MCP tool.
 *
 * Reads `app.event` filtered by date window + optional segments,
 * returning rows in the canonical `CalendarEventRow` shape
 * (`@homehub/shared`). The frontend `listEvents` helper returns the
 * same shape — the two converge on the shared type.
 *
 * Scoping: `householdId` always comes from the auth context; never
 * from client input. The service-role Supabase client bypasses RLS,
 * so we MUST explicitly filter on `household_id`.
 */

import { type Database } from '@homehub/db';
import { SEGMENTS, type CalendarEventRow, type Segment } from '@homehub/shared';
import { type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { z } from 'zod';

import { type AuthContext } from '../middleware/auth.js';

import { jsonResult, parseOrThrow, type ToolResult } from './result.js';

export const LIST_EVENTS_TOOL_NAME = 'list_events';

export const LIST_EVENTS_DESCRIPTION =
  'List calendar events for this household in a date range, optionally filtered by segment.';

export const listEventsInputShape = {
  from: z.string().datetime(),
  to: z.string().datetime(),
  segments: z.array(z.enum(SEGMENTS)).optional(),
  limit: z.number().int().min(1).max(500).default(100),
} as const;

export const listEventsInputSchema = z.object(listEventsInputShape);
export type ListEventsInput = z.infer<typeof listEventsInputSchema>;

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

export interface ListEventsToolDeps {
  supabase: ServiceSupabaseClient;
}

export function createListEventsTool(deps: ListEventsToolDeps): {
  name: string;
  description: string;
  inputSchema: typeof listEventsInputShape;
  handler: (input: unknown, ctx: AuthContext) => Promise<ToolResult>;
} {
  return {
    name: LIST_EVENTS_TOOL_NAME,
    description: LIST_EVENTS_DESCRIPTION,
    inputSchema: listEventsInputShape,
    handler: async (input, ctx) => {
      const parsed = parseOrThrow(listEventsInputSchema, input);
      if (new Date(parsed.to).getTime() <= new Date(parsed.from).getTime()) {
        return jsonResult({ events: [] });
      }
      let query = deps.supabase
        .schema('app')
        .from('event')
        .select(
          'id, household_id, owner_member_id, segment, kind, title, starts_at, ends_at, all_day, location, provider, metadata, source_id, source_version, created_at, updated_at',
        )
        .eq('household_id', ctx.householdId)
        .lt('starts_at', parsed.to)
        .or(`ends_at.gt.${parsed.from},and(ends_at.is.null,starts_at.gte.${parsed.from})`);

      if (parsed.segments && parsed.segments.length > 0) {
        query = query.in('segment', parsed.segments);
      }

      query = query.order('starts_at', { ascending: true }).limit(parsed.limit);

      const { data, error } = await query;
      if (error) {
        throw new Error(`list_events: ${error.message}`);
      }
      const events = (data ?? []).map((row) => toCamel(row as EventRow));
      return jsonResult({ events });
    },
  };
}
