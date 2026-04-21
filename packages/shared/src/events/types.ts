/**
 * Calendar-event shared types.
 *
 * `CalendarEventRow` is the single canonical camelCase shape for
 * `app.event` rows as they travel across process boundaries — the
 * Next.js dashboard (`apps/web/src/lib/events/listEvents.ts`), the
 * MCP `list_events` tool (M3-C), and future graph-browser readers.
 *
 * Keep this flat / serializable. The DB-row type stays in
 * `@homehub/db`; this module is the cross-process contract.
 */

/**
 * Segments mirror the `app.event.segment` check constraint and the
 * `member_segment_grant.segment` values (see
 * `packages/db/migrations` + `specs/02-data-model/row-level-security.md`).
 */
export const SEGMENTS = ['financial', 'food', 'fun', 'social', 'system'] as const;
export type Segment = (typeof SEGMENTS)[number];

export interface CalendarEventRow {
  id: string;
  householdId: string;
  segment: Segment;
  kind: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  provider: string | null;
  ownerMemberId: string | null;
  metadata: Record<string, unknown>;
}
