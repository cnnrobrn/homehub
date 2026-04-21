/**
 * Executor for the `settle_shared_expense` action kind.
 *
 * Similar to `propose_transfer` (intent-only, no upstream write) but
 * additionally drafts a Gmail message to the counterparty nudging them
 * to send the owed amount. Audit + memory episode same as
 * `propose_transfer`; the draft is the delta.
 *
 * Destructive kind — always requires a human tap (see
 * `AUTO_APPROVAL_DENY_LIST`).
 */

import { type Json } from '@homehub/db';
import { type EmailProvider } from '@homehub/providers-email';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const settleSharedExpensePayloadSchema = z.object({
  counterparty_email: z.string().email(),
  counterparty_name: z.string().min(1),
  amount_cents: z.number().int().positive(),
  currency: z.string().default('USD'),
  reason: z.string().min(1),
  subject: z.string().optional(),
  body_markdown: z.string().optional(),
});

export type SettleSharedExpensePayload = z.infer<typeof settleSharedExpensePayloadSchema>;

export interface CreateSettleSharedExpenseExecutorArgs {
  email: EmailProvider;
  supabase: ExecutorDeps['supabase'];
  now?: () => Date;
}

function defaultBody(args: {
  name: string;
  amount: number;
  currency: string;
  reason: string;
}): string {
  const formatted =
    args.currency === 'USD'
      ? `$${args.amount.toFixed(2)}`
      : `${args.amount.toFixed(2)} ${args.currency}`;
  return [
    `Hey ${args.name},`,
    '',
    `You owe me ${formatted} for ${args.reason} — send it my way when you can.`,
    '',
    'Thanks!',
  ].join('\n');
}

export function createSettleSharedExpenseExecutor(
  deps: CreateSettleSharedExpenseExecutorArgs,
): ActionExecutor {
  const now = deps.now ?? (() => new Date());
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: SettleSharedExpensePayload;
    try {
      payload = settleSharedExpensePayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    const stamp = now().toISOString();
    const amount = payload.amount_cents / 100;

    const conn = await resolveConnection(deps.supabase, {
      householdId: action.household_id,
      provider: 'gmail',
    });
    if (!conn) {
      throw new PermanentExecutorError(
        'no_gmail_connection',
        `household ${action.household_id} has no active google-mail connection`,
      );
    }

    const subject = payload.subject ?? `Settling up — ${payload.reason}`;
    const body =
      payload.body_markdown ??
      defaultBody({
        name: payload.counterparty_name,
        amount,
        currency: payload.currency,
        reason: payload.reason,
      });

    let draftOut: { draftId: string; threadId: string; messageId: string };
    try {
      draftOut = await deps.email.createDraft({
        connectionId: conn.connectionId,
        to: [payload.counterparty_email],
        subject,
        bodyMarkdown: body,
      });
    } catch (err) {
      if (err instanceof PermanentExecutorError) throw err;
      throwAsExecutorError(err, 'gmail_draft_write_failed');
    }

    // Audit event.
    const { error: auditErr } = await deps.supabase
      .schema('audit')
      .from('event')
      .insert({
        household_id: action.household_id,
        actor_user_id: null,
        action: 'financial.settle_shared_expense.logged',
        resource_type: 'app.action',
        resource_id: action.id,
        before: null,
        after: {
          counterparty_email: payload.counterparty_email,
          counterparty_name: payload.counterparty_name,
          amount_cents: payload.amount_cents,
          currency: payload.currency,
          reason: payload.reason,
          draft_id: draftOut.draftId,
        } as unknown as Json,
      });
    if (auditErr) {
      throw new PermanentExecutorError(
        'audit_write_failed',
        `audit.event insert failed: ${auditErr.message}`,
      );
    }

    // Memory episode.
    const { error: episodeErr } = await deps.supabase
      .schema('mem')
      .from('episode')
      .insert({
        household_id: action.household_id,
        title: `Settle-up drafted: ${payload.counterparty_name} owes ${amount} ${payload.currency}`,
        summary: payload.reason,
        occurred_at: stamp,
        source_id: action.id,
        source_type: 'financial.settle_shared_expense.logged',
        metadata: {
          counterparty_email: payload.counterparty_email,
          amount_cents: payload.amount_cents,
          currency: payload.currency,
          draft_id: draftOut.draftId,
        } as unknown as Json,
      });
    if (episodeErr) {
      throw new PermanentExecutorError(
        'episode_write_failed',
        `mem.episode insert failed: ${episodeErr.message}`,
      );
    }

    log.info('settle_shared_expense draft + audit written', {
      draft_id: draftOut.draftId,
      amount_cents: payload.amount_cents,
    });

    return {
      result: {
        draft_id: draftOut.draftId,
        thread_id: draftOut.threadId,
        message_id: draftOut.messageId,
        audited: true,
      },
    };
  };
}
