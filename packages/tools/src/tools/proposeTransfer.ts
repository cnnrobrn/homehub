/**
 * `propose_transfer` — draft-write.
 *
 * Inserts an `app.suggestion` row with `kind='propose_transfer'`,
 * `segment='financial'`. The suggestion captures the intended transfer;
 * the executor (M9-B) places the real transfer through the connected
 * banking provider after a human approves.
 *
 * Destructive. `cancel_subscription` / `propose_transfer` /
 * `settle_shared_expense` are all on the approval-flow deny-list, so
 * even a household with `auto_approve_kinds` set cannot skip human
 * approval for these kinds.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

const inputSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3).default('USD'),
  reason: z.string().min(1).max(500),
});

const outputSchema = z.object({
  status: z.literal('pending_approval'),
  suggestion_id: z.string(),
  preview: z.object({
    from_account_id: z.string(),
    to_account_id: z.string(),
    amount_cents: z.number(),
    currency: z.string(),
    reason: z.string(),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const proposeTransferTool: ToolDefinition<Input, Output> = {
  name: 'propose_transfer',
  description:
    'Propose a transfer between household accounts. Writes an app.suggestion the member must approve; execution happens after approval.',
  class: 'draft-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['financial'],
  async handler(args, ctx) {
    if (args.from_account_id === args.to_account_id) {
      throw new ToolError('invalid_accounts', 'propose_transfer: from and to accounts must differ');
    }
    const preview = {
      from_account_id: args.from_account_id,
      to_account_id: args.to_account_id,
      amount_cents: args.amount_cents,
      currency: args.currency,
      reason: args.reason,
    };
    const amountUsd = (args.amount_cents / 100).toFixed(2);
    const title = `Transfer $${amountUsd} ${args.currency}`;
    const rationale = args.reason;

    const { data, error } = await ctx.supabase
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: ctx.householdId,
        segment: 'financial',
        kind: 'propose_transfer',
        title,
        rationale,
        preview: preview as never,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `propose_transfer insert: ${error.message}`);

    ctx.log.info('propose_transfer suggestion created', {
      household_id: ctx.householdId,
      suggestion_id: data.id,
      amount_cents: args.amount_cents,
    });

    return {
      status: 'pending_approval',
      suggestion_id: data.id as string,
      preview,
    };
  },
};
