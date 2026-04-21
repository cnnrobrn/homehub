/**
 * Executor for the `cancel_subscription` action kind.
 *
 * v1 reality: HomeHub can't auto-cancel subscriptions via API — every
 * provider has its own flow, many require a login + human click. So
 * we draft a polite cancellation email to the subscription merchant
 * using the contact email we already know (`mem.node type='subscription'
 * .metadata.contact_email`) and hand the member a markdown note
 * reminding them to review and send from Gmail.
 *
 * This is a destructive kind by the approval-flow contract (see
 * `AUTO_APPROVAL_DENY_LIST` in `packages/approval-flow/src/policies.ts`)
 * — it always requires a human tap.
 */

import { type EmailProvider } from '@homehub/providers-email';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const cancelSubscriptionPayloadSchema = z.object({
  subscription_node_id: z.string().uuid(),
  subscription_name: z.string().min(1),
  recipient_email: z.string().email().optional(),
  subject: z.string().optional(),
  body_markdown: z.string().optional(),
});

export type CancelSubscriptionPayload = z.infer<typeof cancelSubscriptionPayloadSchema>;

export interface CreateCancelSubscriptionExecutorArgs {
  email: EmailProvider;
  supabase: ExecutorDeps['supabase'];
}

function defaultBody(name: string): string {
  return [
    `Hi ${name} team,`,
    '',
    `Please cancel my ${name} subscription effective immediately.`,
    '',
    'Thank you.',
  ].join('\n');
}

const GUIDANCE_MD =
  '**This was drafted, not sent.** Review the draft in Gmail, ' +
  'confirm that it reflects what you want to say, and send it yourself. ' +
  "HomeHub intentionally does not auto-send cancellations — you're the " +
  'last line of defense against a premature send.';

export function createCancelSubscriptionExecutor(
  deps: CreateCancelSubscriptionExecutorArgs,
): ActionExecutor {
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: CancelSubscriptionPayload;
    try {
      payload = cancelSubscriptionPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    // Resolve the recipient from the subscription node when the
    // payload didn't carry it explicitly.
    let recipient = payload.recipient_email;
    if (!recipient) {
      const { data: node, error } = await deps.supabase
        .schema('mem')
        .from('node')
        .select('metadata')
        .eq('id', payload.subscription_node_id)
        .eq('household_id', action.household_id)
        .maybeSingle();
      if (error) {
        throw new Error(`mem.node lookup failed: ${error.message}`);
      }
      const meta = (node as { metadata?: unknown } | null)?.metadata as
        | { contact_email?: unknown }
        | null
        | undefined;
      if (meta && typeof meta.contact_email === 'string' && meta.contact_email.includes('@')) {
        recipient = meta.contact_email;
      }
    }

    if (!recipient) {
      throw new PermanentExecutorError(
        'no_subscription_contact_email',
        `subscription ${payload.subscription_node_id} has no known contact email`,
      );
    }

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

    const subject = payload.subject ?? `Cancellation request — ${payload.subscription_name}`;
    const body = payload.body_markdown ?? defaultBody(payload.subscription_name);

    log.info('drafting cancellation email', {
      subscription: payload.subscription_name,
    });

    try {
      const draft = await deps.email.createDraft({
        connectionId: conn.connectionId,
        to: [recipient],
        subject,
        bodyMarkdown: body,
      });
      return {
        result: {
          draft_id: draft.draftId,
          thread_id: draft.threadId,
          message_id: draft.messageId,
          recipient_email: recipient,
          guidance_md: GUIDANCE_MD,
          connection_id: conn.connectionRowId,
        },
      };
    } catch (err) {
      if (err instanceof PermanentExecutorError) throw err;
      throwAsExecutorError(err, 'gmail_draft_write_failed');
    }
  };
}
