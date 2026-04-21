/**
 * `propose_cancel_subscription` — draft-write.
 *
 * Inserts an `app.suggestion` row with `kind='cancel_subscription'`,
 * `segment='financial'`. The executor (M9-B) ends the recurring charge
 * through the provider or drafts the cancellation email after the
 * member approves.
 *
 * Destructive + on the auto-approval deny-list: the state machine
 * refuses to auto-approve this kind even if the household has it
 * listed in `auto_approve_kinds`.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

const inputSchema = z.object({
  subscription_node_id: z.string().uuid(),
  merchant_name: z.string().min(1).max(200),
  monthly_cost_cents: z.number().int().nonnegative().optional(),
  rationale: z.string().max(2_000).optional(),
});

const outputSchema = z.object({
  status: z.literal('pending_approval'),
  suggestion_id: z.string(),
  preview: z.object({
    subscription_node_id: z.string(),
    merchant_name: z.string(),
    monthly_cost_cents: z.number().nullable(),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const proposeCancelSubscriptionTool: ToolDefinition<Input, Output> = {
  name: 'propose_cancel_subscription',
  description:
    'Propose cancelling a recurring subscription charge. Writes an app.suggestion the member must approve; execution (provider cancel / draft email) happens after approval.',
  class: 'draft-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['financial'],
  async handler(args, ctx) {
    const preview = {
      subscription_node_id: args.subscription_node_id,
      merchant_name: args.merchant_name,
      monthly_cost_cents: args.monthly_cost_cents ?? null,
    };
    const title = `Cancel ${args.merchant_name}`;
    const rationale =
      args.rationale ??
      `Cancel recurring charges for ${args.merchant_name}${
        args.monthly_cost_cents ? ` (≈$${(args.monthly_cost_cents / 100).toFixed(2)}/mo)` : ''
      }.`;

    const { data, error } = await ctx.supabase
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: ctx.householdId,
        segment: 'financial',
        kind: 'cancel_subscription',
        title,
        rationale,
        preview: preview as never,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error)
      throw new ToolError('db_error', `propose_cancel_subscription insert: ${error.message}`);

    ctx.log.info('propose_cancel_subscription suggestion created', {
      household_id: ctx.householdId,
      suggestion_id: data.id,
      merchant_name: args.merchant_name,
    });

    return {
      status: 'pending_approval',
      suggestion_id: data.id as string,
      preview,
    };
  },
};
