/**
 * Server actions for chat / conversation lifecycle.
 *
 * Streaming lives at `POST /api/chat/stream` (a route handler) because
 * Server Actions can't return a ReadableStream to the client. These
 * actions cover everything else: create, list, archive, delete.
 *
 * Every action is `household_id`-scoped. The service client is used
 * because RLS on `app.conversation` is household-keyed but our
 * request-scoped member client doesn't have household-level grants
 * unless the member explicitly holds `system:write`; service-role
 * writes after an auth check keep behaviour uniform with the rest of
 * the app's actions (see `actions/memory.ts`).
 */

'use server';

import {
  UnauthorizedError,
  createServiceClient,
  getUser,
  resolveMemberId,
} from '@homehub/auth-server';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';

const createConversationSchema = z.object({
  householdId: z.string().uuid(),
  title: z.string().max(200).optional(),
});

export interface ConversationRow {
  id: string;
  household_id: string;
  title: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
  pinned: boolean;
  archived_at: string | null;
}

async function authedActor(householdId: string): Promise<{
  userId: string;
  memberId: string;
  service: ReturnType<typeof createServiceClient>;
}> {
  const env = authEnv();
  const cookies = await nextCookieAdapter();
  const user = await getUser(env, cookies);
  if (!user) throw new UnauthorizedError('no session');
  const service = createServiceClient(env);
  const memberId = await resolveMemberId(service, householdId, user.id);
  if (!memberId) throw new UnauthorizedError('not a member of this household');
  return { userId: user.id, memberId, service };
}

export async function createConversationAction(
  input: z.input<typeof createConversationSchema>,
): Promise<ActionResult<{ conversationId: string }>> {
  try {
    const parsed = createConversationSchema.parse(input);
    const { memberId, service } = await authedActor(parsed.householdId);
    const { data, error } = await service
      .schema('app')
      .from('conversation')
      .insert({
        household_id: parsed.householdId,
        title: parsed.title ?? null,
        created_by: memberId,
      })
      .select('id')
      .single();
    if (error) throw new Error(`createConversation: ${error.message}`);
    return ok({ conversationId: data.id });
  } catch (err) {
    return toErr(err);
  }
}

const listConversationsSchema = z.object({
  householdId: z.string().uuid(),
  includeArchived: z.boolean().optional(),
});

export async function listConversationsAction(
  input: z.input<typeof listConversationsSchema>,
): Promise<ActionResult<ConversationRow[]>> {
  try {
    const parsed = listConversationsSchema.parse(input);
    const { service } = await authedActor(parsed.householdId);
    let q = service
      .schema('app')
      .from('conversation')
      .select(
        'id, household_id, title, created_by, created_at, last_message_at, pinned, archived_at',
      )
      .eq('household_id', parsed.householdId);
    if (!parsed.includeArchived) q = q.is('archived_at', null);
    q = q.order('pinned', { ascending: false }).order('last_message_at', { ascending: false });
    const { data, error } = await q;
    if (error) throw new Error(`listConversations: ${error.message}`);
    return ok((data ?? []) as ConversationRow[]);
  } catch (err) {
    return toErr(err);
  }
}

const archiveConversationSchema = z.object({
  householdId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

export async function archiveConversationAction(
  input: z.input<typeof archiveConversationSchema>,
): Promise<ActionResult<{ archived: true }>> {
  try {
    const parsed = archiveConversationSchema.parse(input);
    const { service } = await authedActor(parsed.householdId);
    const { error } = await service
      .schema('app')
      .from('conversation')
      .update({ archived_at: new Date().toISOString() })
      .eq('household_id', parsed.householdId)
      .eq('id', parsed.conversationId);
    if (error) throw new Error(`archiveConversation: ${error.message}`);
    return ok({ archived: true });
  } catch (err) {
    return toErr(err);
  }
}

const deleteConversationSchema = z.object({
  householdId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

export async function deleteConversationAction(
  input: z.input<typeof deleteConversationSchema>,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const parsed = deleteConversationSchema.parse(input);
    const { service } = await authedActor(parsed.householdId);
    // Delete turns first to respect the FK (no cascade in the migration).
    const turnRes = await service
      .schema('app')
      .from('conversation_turn')
      .delete()
      .eq('household_id', parsed.householdId)
      .eq('conversation_id', parsed.conversationId);
    if (turnRes.error) throw new Error(`deleteConversation turns: ${turnRes.error.message}`);
    const convRes = await service
      .schema('app')
      .from('conversation')
      .delete()
      .eq('household_id', parsed.householdId)
      .eq('id', parsed.conversationId);
    if (convRes.error) throw new Error(`deleteConversation: ${convRes.error.message}`);
    return ok({ deleted: true });
  } catch (err) {
    return toErr(err);
  }
}
