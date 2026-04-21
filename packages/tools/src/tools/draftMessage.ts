/**
 * `draft_message` — draft-write.
 *
 * Inserts an `app.suggestion` row with `kind='draft_message'`,
 * `segment='social'`. The executor (M9-B) creates a Gmail draft for
 * the member to review; the message is only sent after the member
 * hits Approve in the UI.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

const inputSchema = z.object({
  /**
   * Recipient descriptor: either a free-form email / phone / name or
   * a member/person node id the UI resolves.
   */
  to: z.string().min(1).max(500),
  subject: z.string().max(200).optional(),
  body_markdown: z.string().min(1).max(20_000),
  /**
   * Optional linked `mem.node` id for the recipient so the approval UI
   * can render the person's canonical name + avatar.
   */
  recipient_node_id: z.string().uuid().optional(),
});

const outputSchema = z.object({
  status: z.literal('pending_approval'),
  suggestion_id: z.string(),
  preview: z.object({
    to: z.string(),
    subject: z.string().nullable(),
    body_markdown: z.string(),
    recipient_node_id: z.string().nullable(),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const draftMessageTool: ToolDefinition<Input, Output> = {
  name: 'draft_message',
  description:
    'Draft a message (email) to someone. Creates a Gmail draft after approval; nothing is sent without a human tap.',
  class: 'draft-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['social'],
  async handler(args, ctx) {
    const preview = {
      to: args.to,
      subject: args.subject ?? null,
      body_markdown: args.body_markdown,
      recipient_node_id: args.recipient_node_id ?? null,
    };
    const title = args.subject ? `Draft: ${args.subject}` : `Draft message to ${args.to}`;
    const rationale = `Draft message to ${args.to}. Creates a Gmail draft on approval.`;

    const { data, error } = await ctx.supabase
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: ctx.householdId,
        segment: 'social',
        kind: 'draft_message',
        title,
        rationale,
        preview: preview as never,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `draft_message insert: ${error.message}`);

    ctx.log.info('draft_message suggestion created', {
      household_id: ctx.householdId,
      suggestion_id: data.id,
    });

    return {
      status: 'pending_approval',
      suggestion_id: data.id as string,
      preview,
    };
  },
};
