/**
 * Executor for the `draft_message` action kind.
 *
 * Creates a Gmail draft in the household member's Drafts folder. The
 * draft is never auto-sent — the member reviews in Gmail and decides
 * when to send (see `specs/05-agents/approval-flow.md` § send_message).
 */

import { type EmailProvider } from '@homehub/providers-email';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const draftMessagePayloadSchema = z.object({
  to: z.array(z.string().email()).min(1, 'at least one recipient is required'),
  subject: z.string().min(1, 'subject is required'),
  body_markdown: z.string().min(1, 'body_markdown is required'),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  thread_id: z.string().optional(),
});

export type DraftMessagePayload = z.infer<typeof draftMessagePayloadSchema>;

export interface CreateDraftMessageExecutorArgs {
  email: EmailProvider;
  supabase: ExecutorDeps['supabase'];
}

export function createDraftMessageExecutor(deps: CreateDraftMessageExecutorArgs): ActionExecutor {
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: DraftMessagePayload;
    try {
      payload = draftMessagePayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
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

    log.info('creating gmail draft', {
      connection_row_id: conn.connectionRowId,
      recipient_count: payload.to.length,
    });

    try {
      const draft = await deps.email.createDraft({
        connectionId: conn.connectionId,
        to: payload.to,
        subject: payload.subject,
        bodyMarkdown: payload.body_markdown,
        ...(payload.cc ? { cc: payload.cc } : {}),
        ...(payload.bcc ? { bcc: payload.bcc } : {}),
        ...(payload.thread_id ? { threadId: payload.thread_id } : {}),
      });
      return {
        result: {
          draft_id: draft.draftId,
          thread_id: draft.threadId,
          message_id: draft.messageId,
          connection_id: conn.connectionRowId,
        },
      };
    } catch (err) {
      if (err instanceof PermanentExecutorError) throw err;
      throwAsExecutorError(err, 'gmail_draft_write_failed');
    }
  };
}
