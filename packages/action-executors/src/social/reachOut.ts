/**
 * Executor for the `reach_out` action kind.
 *
 * Same shape as `draft_message` but scoped to a specific person node.
 *
 * For `channel='email'`: resolve the person's email from
 * `mem.fact` predicate `has_email` OR `app.person.metadata.emails[0]`,
 * then draft via Gmail.
 *
 * For `channel='text'`: return a `text_channel_pending` sentinel with
 * no side effect. SMS integration is post-v1 (see briefing non-goals).
 */

import { type EmailProvider } from '@homehub/providers-email';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const reachOutPayloadSchema = z.object({
  person_node_id: z.string().uuid(),
  channel: z.enum(['email', 'text']),
  body_markdown: z.string().min(1),
  subject: z.string().optional(),
});

export type ReachOutPayload = z.infer<typeof reachOutPayloadSchema>;

export interface CreateReachOutExecutorArgs {
  email: EmailProvider;
  supabase: ExecutorDeps['supabase'];
}

/**
 * Look up the person's email address. Prefers a canonical `has_email`
 * fact; falls back to `app.person.metadata.emails[0]`.
 */
async function resolveRecipientEmail(
  supabase: ExecutorDeps['supabase'],
  householdId: string,
  personNodeId: string,
): Promise<string | null> {
  // 1. mem.fact predicate=has_email, subject=person_node_id.
  const { data: factRows, error: factErr } = await supabase
    .schema('mem')
    .from('fact')
    .select('object_value')
    .eq('household_id', householdId)
    .eq('subject_node_id', personNodeId)
    .eq('predicate', 'has_email')
    .is('valid_to', null)
    .is('superseded_at', null)
    .limit(1);
  if (factErr) {
    throw new Error(`mem.fact lookup failed: ${factErr.message}`);
  }
  const factEmail = (factRows?.[0] as { object_value?: unknown } | undefined)?.object_value;
  if (typeof factEmail === 'string' && factEmail.includes('@')) {
    return factEmail;
  }

  // 2. app.person.metadata.emails[0]. person.id can equal the node id
  // but the safe lookup is by node id inside metadata. Prefer: match
  // any person row whose metadata links to the node.
  const { data: personRows, error: personErr } = await supabase
    .schema('app')
    .from('person')
    .select('id, metadata')
    .eq('household_id', householdId);
  if (personErr) {
    throw new Error(`app.person lookup failed: ${personErr.message}`);
  }
  for (const row of (personRows ?? []) as { id: string; metadata: unknown }[]) {
    const meta = row.metadata as { node_id?: string; emails?: unknown } | null;
    if (!meta) continue;
    const matchesByNodeId = meta.node_id === personNodeId;
    const matchesById = row.id === personNodeId;
    if (matchesByNodeId || matchesById) {
      const emails = Array.isArray(meta.emails) ? meta.emails : [];
      const first = emails.find((e): e is string => typeof e === 'string' && e.includes('@'));
      if (first) return first;
    }
  }

  return null;
}

export function createReachOutExecutor(deps: CreateReachOutExecutorArgs): ActionExecutor {
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: ReachOutPayload;
    try {
      payload = reachOutPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    if (payload.channel === 'text') {
      // SMS integration is explicitly post-v1. We return a sentinel so
      // the UI can surface "HomeHub can't text yet — send from your
      // phone" without the action ever entering a failed state.
      log.info('reach_out text channel is a no-op (v1 pending SMS integration)');
      return { result: { status: 'text_channel_pending', channel: 'text' } };
    }

    const recipient = await resolveRecipientEmail(
      deps.supabase,
      action.household_id,
      payload.person_node_id,
    );
    if (!recipient) {
      throw new PermanentExecutorError(
        'no_email_for_person',
        `person ${payload.person_node_id} has no resolvable email address`,
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

    const subject = payload.subject ?? 'Hi from HomeHub';

    try {
      const draft = await deps.email.createDraft({
        connectionId: conn.connectionId,
        to: [recipient],
        subject,
        bodyMarkdown: payload.body_markdown,
      });
      return {
        result: {
          draft_id: draft.draftId,
          thread_id: draft.threadId,
          message_id: draft.messageId,
          recipient_email: recipient,
          connection_id: conn.connectionRowId,
        },
      };
    } catch (err) {
      if (err instanceof PermanentExecutorError) throw err;
      throwAsExecutorError(err, 'gmail_draft_write_failed');
    }
  };
}
