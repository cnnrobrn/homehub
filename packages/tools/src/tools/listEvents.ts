/**
 * `list_events` — window read of `app.event`.
 *
 * Shape matches `CalendarEventRow` from `@homehub/shared` so the
 * foreground agent, the MCP `list_events` tool, and the frontend
 * calendar converge on one row type.
 *
 * If the caller passes `segments`, we intersect with the member's
 * grants — the model cannot widen visibility past the caller's own
 * read access. Segments with access `none` are silently dropped;
 * if the intersection is empty, the tool returns an empty list
 * (this is not a forbidden condition — the member just has no
 * visible segments in that scope).
 */

import { SEGMENTS, type CalendarEventRow, type Segment } from '@homehub/shared';
import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

import type { Database } from '@homehub/db';

type EventRow = Database['app']['Tables']['event']['Row'];

const inputSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  segments: z.array(z.enum(SEGMENTS)).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const eventSchema: z.ZodType<CalendarEventRow> = z.object({
  id: z.string(),
  householdId: z.string(),
  segment: z.enum(SEGMENTS),
  kind: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  provider: z.string().nullable(),
  ownerMemberId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

const outputSchema = z.object({ events: z.array(eventSchema) });

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

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

export const listEventsTool: ToolDefinition<Input, Output> = {
  name: 'list_events',
  description:
    'List calendar events in a date range. Optionally filter by segment; results always respect the caller’s segment grants.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  // `list_events` is always available in principle — the *rows* returned
  // are intersected with the caller's grants. If the caller has no
  // readable segments, the tool returns an empty list rather than
  // blocking the call.
  segments: 'all',
  async handler(args, ctx) {
    if (new Date(args.to).getTime() <= new Date(args.from).getTime()) {
      return { events: [] };
    }
    const readable = ctx.grants
      .filter((g) => g.access === 'read' || g.access === 'write')
      .map((g) => g.segment);
    const requested = args.segments && args.segments.length > 0 ? args.segments : null;
    const scope = requested ? requested.filter((s) => readable.includes(s)) : readable;
    // `member` always has `system`? No — system grants are explicit. If
    // the member has no readable segments at all, return empty.
    if (scope.length === 0) return { events: [] };

    let q = ctx.supabase
      .schema('app')
      .from('event')
      .select(
        'id, household_id, owner_member_id, segment, kind, title, starts_at, ends_at, all_day, location, provider, metadata, source_id, source_version, created_at, updated_at',
      )
      .eq('household_id', ctx.householdId)
      .lt('starts_at', args.to)
      .or(`ends_at.gt.${args.from},and(ends_at.is.null,starts_at.gte.${args.from})`)
      .in('segment', scope);
    q = q.order('starts_at', { ascending: true }).limit(args.limit ?? 100);
    const { data, error } = await q;
    if (error) throw new ToolError('db_error', `list_events: ${error.message}`);
    return { events: (data ?? []).map((row) => toCamel(row as EventRow)) };
  },
};
