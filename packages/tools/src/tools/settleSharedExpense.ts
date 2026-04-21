/**
 * `settle_shared_expense` — draft-write.
 *
 * Inserts an `app.suggestion` row with `kind='settle_shared_expense'`,
 * `segment='financial'`. The executor (M9-B) records the settlement
 * (e.g. a Venmo / Zelle / manual ledger entry) after the member
 * approves.
 *
 * Destructive + on the auto-approval deny-list — the state machine
 * refuses to auto-approve even when the household enables the kind.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

const inputSchema = z.object({
  counterparty_member_id: z.string().uuid(),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3).default('USD'),
  direction: z.enum(['owe_them', 'they_owe_us']),
  reason: z.string().min(1).max(500),
});

const outputSchema = z.object({
  status: z.literal('pending_approval'),
  suggestion_id: z.string(),
  preview: z.object({
    counterparty_member_id: z.string(),
    amount_cents: z.number(),
    currency: z.string(),
    direction: z.string(),
    reason: z.string(),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const settleSharedExpenseTool: ToolDefinition<Input, Output> = {
  name: 'settle_shared_expense',
  description:
    'Propose settling a shared expense between household members. Writes an app.suggestion the approver confirms before the settlement is recorded.',
  class: 'draft-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['financial'],
  async handler(args, ctx) {
    const preview = {
      counterparty_member_id: args.counterparty_member_id,
      amount_cents: args.amount_cents,
      currency: args.currency,
      direction: args.direction,
      reason: args.reason,
    };
    const amountUsd = (args.amount_cents / 100).toFixed(2);
    const title = `Settle $${amountUsd} ${args.currency}`;
    const rationale = `${args.direction === 'owe_them' ? 'Owe' : 'Owed by'} counterparty · ${args.reason}`;

    const { data, error } = await ctx.supabase
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: ctx.householdId,
        segment: 'financial',
        kind: 'settle_shared_expense',
        title,
        rationale,
        preview: preview as never,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `settle_shared_expense insert: ${error.message}`);

    ctx.log.info('settle_shared_expense suggestion created', {
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
