/**
 * `propose_add_to_calendar` — draft-write.
 *
 * Inserts an `app.suggestion` row with `kind='add_to_calendar'` (or
 * `propose_add_to_calendar` — both are accepted by the default policy
 * set). `segment` is inferred from the event content; when ambiguous,
 * defaults to `'social'` per the M9-C dispatch.
 *
 * The executor (M9-B) writes an `app.event` row and optionally mirrors
 * to Google Calendar when `mirror_to_gcal=true`.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

const SEGMENTS = ['financial', 'food', 'fun', 'social'] as const;
type Segment = (typeof SEGMENTS)[number];

const inputSchema = z.object({
  title: z.string().min(1).max(200),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).optional(),
  location: z.string().max(500).optional(),
  attendees: z.array(z.string()).max(50).optional(),
  mirror_to_gcal: z.boolean().default(false),
  /**
   * Optional explicit segment. When omitted, the handler infers the
   * segment from the title (simple keyword match) and defaults to
   * `'social'` when nothing matches.
   */
  segment: z.enum(SEGMENTS).optional(),
});

const outputSchema = z.object({
  status: z.literal('pending_approval'),
  suggestion_id: z.string(),
  preview: z.object({
    title: z.string(),
    starts_at: z.string(),
    ends_at: z.string().nullable(),
    location: z.string().nullable(),
    attendees: z.array(z.string()),
    mirror_to_gcal: z.boolean(),
    segment: z.string(),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

function inferSegment(title: string): Segment {
  const lower = title.toLowerCase();
  if (/\b(lunch|dinner|brunch|meal|restaurant|reservation|grocery|groceries|cook)\b/.test(lower)) {
    return 'food';
  }
  if (/\b(concert|movie|game|hike|trip|vacation|museum|park)\b/.test(lower)) {
    return 'fun';
  }
  if (/\b(pay|bill|invoice|tax|bank|budget|transfer)\b/.test(lower)) {
    return 'financial';
  }
  return 'social';
}

export const proposeAddToCalendarTool: ToolDefinition<Input, Output> = {
  name: 'propose_add_to_calendar',
  description:
    'Propose adding an event to the household calendar. Writes an app.suggestion; execution creates the app.event row (and optionally mirrors to Google Calendar) after approval.',
  class: 'draft-write',
  input: inputSchema,
  output: outputSchema,
  segments: 'all',
  async handler(args, ctx) {
    const segment = args.segment ?? inferSegment(args.title);
    // Segment-access check: the caller must hold write on the chosen
    // segment. The catalog normally gates this but because we accept
    // `'all'` we re-check here. A member with no grants at all cannot
    // create a calendar suggestion.
    const grant = ctx.grants.find((g) => g.segment === segment);
    if (!grant || grant.access !== 'write') {
      throw new ToolError(
        'tool_forbidden',
        `propose_add_to_calendar: missing write on segment '${segment}'`,
      );
    }

    const preview = {
      title: args.title,
      starts_at: args.starts_at,
      ends_at: args.ends_at ?? null,
      location: args.location ?? null,
      attendees: args.attendees ?? [],
      mirror_to_gcal: args.mirror_to_gcal,
      segment,
    };
    const title = `Propose: ${args.title}`;
    const rationale = `Add "${args.title}" to the calendar on ${new Date(
      args.starts_at,
    ).toLocaleString()}${args.mirror_to_gcal ? ' (mirrors to Google Calendar)' : ''}.`;

    const { data, error } = await ctx.supabase
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: ctx.householdId,
        segment,
        kind: 'propose_add_to_calendar',
        title,
        rationale,
        preview: preview as never,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `propose_add_to_calendar insert: ${error.message}`);

    ctx.log.info('propose_add_to_calendar suggestion created', {
      household_id: ctx.householdId,
      suggestion_id: data.id,
      segment,
    });

    return {
      status: 'pending_approval',
      suggestion_id: data.id as string,
      preview,
    };
  },
};
