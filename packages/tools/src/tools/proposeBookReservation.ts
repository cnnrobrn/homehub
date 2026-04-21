/**
 * `propose_book_reservation` — draft-write.
 *
 * Inserts an `app.suggestion` row with `kind='propose_book_reservation'`,
 * `segment='food'`. The executor (M9-B) drafts the reservation (email
 * to the venue, or an OpenTable call when wired) after approval.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

const inputSchema = z.object({
  venue_name: z.string().min(1).max(200),
  venue_node_id: z.string().uuid().optional(),
  party_size: z.number().int().positive().max(50),
  proposed_times: z
    .array(z.string().datetime({ offset: true }))
    .min(1)
    .max(5),
  recipient_email: z.string().email().optional(),
  notes: z.string().max(2_000).optional(),
});

const outputSchema = z.object({
  status: z.literal('pending_approval'),
  suggestion_id: z.string(),
  preview: z.object({
    venue_name: z.string(),
    venue_node_id: z.string().nullable(),
    party_size: z.number(),
    proposed_times: z.array(z.string()),
    recipient_email: z.string().nullable(),
    notes: z.string().nullable(),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const proposeBookReservationTool: ToolDefinition<Input, Output> = {
  name: 'propose_book_reservation',
  description:
    'Propose booking a reservation at a venue. Writes an app.suggestion; execution drafts the request (email or provider call) after approval.',
  class: 'draft-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const preview = {
      venue_name: args.venue_name,
      venue_node_id: args.venue_node_id ?? null,
      party_size: args.party_size,
      proposed_times: args.proposed_times,
      recipient_email: args.recipient_email ?? null,
      notes: args.notes ?? null,
    };
    const title = `Book ${args.venue_name} for ${args.party_size}`;
    const rationale = `Reservation at ${args.venue_name} for party of ${args.party_size}. Times: ${args.proposed_times.join(', ')}.`;

    const { data, error } = await ctx.supabase
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: ctx.householdId,
        segment: 'food',
        kind: 'propose_book_reservation',
        title,
        rationale,
        preview: preview as never,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `propose_book_reservation insert: ${error.message}`);

    ctx.log.info('propose_book_reservation suggestion created', {
      household_id: ctx.householdId,
      suggestion_id: data.id,
      venue: args.venue_name,
    });

    return {
      status: 'pending_approval',
      suggestion_id: data.id as string,
      preview,
    };
  },
};
