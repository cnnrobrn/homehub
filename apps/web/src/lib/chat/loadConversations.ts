/**
 * Server-side helpers for loading chat data.
 *
 * Kept close to `lib/memory/query.ts` in shape: service-role client
 * after the caller has already resolved a household context, all
 * queries scoped by `householdId`.
 */

import { createServiceClient } from '@homehub/auth-server';

import { authEnv } from '@/lib/auth/env';

export interface ConversationListRow {
  id: string;
  title: string | null;
  created_at: string;
  last_message_at: string;
  pinned: boolean;
  archived_at: string | null;
}

export interface ConversationTurnDisplayRow {
  id: string;
  role: string;
  body_md: string;
  author_member_id: string | null;
  author_display_name: string | null;
  created_at: string;
  tool_calls: unknown;
  citations: unknown;
  model: string | null;
}

export async function listConversationsForHousehold(
  householdId: string,
): Promise<ConversationListRow[]> {
  const service = createServiceClient(authEnv());
  const { data, error } = await service
    .schema('app')
    .from('conversation')
    .select('id, title, created_at, last_message_at, pinned, archived_at')
    .eq('household_id', householdId)
    .is('archived_at', null)
    .order('pinned', { ascending: false })
    .order('last_message_at', { ascending: false });
  if (error) throw new Error(`listConversationsForHousehold: ${error.message}`);
  return (data ?? []) as ConversationListRow[];
}

export async function loadConversationThread(args: {
  householdId: string;
  conversationId: string;
  limit?: number;
}): Promise<{
  conversation: { id: string; title: string | null; last_message_at: string } | null;
  turns: ConversationTurnDisplayRow[];
}> {
  const service = createServiceClient(authEnv());
  const { data: conv, error: convErr } = await service
    .schema('app')
    .from('conversation')
    .select('id, title, last_message_at')
    .eq('household_id', args.householdId)
    .eq('id', args.conversationId)
    .maybeSingle();
  if (convErr) throw new Error(`loadConversationThread conv: ${convErr.message}`);
  if (!conv) return { conversation: null, turns: [] };

  const { data: turns, error: turnErr } = await service
    .schema('app')
    .from('conversation_turn')
    .select('id, role, body_md, author_member_id, created_at, tool_calls, citations, model')
    .eq('household_id', args.householdId)
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: true })
    .limit(args.limit ?? 50);
  if (turnErr) throw new Error(`loadConversationThread turns: ${turnErr.message}`);
  const rows = (turns ?? []) as Array<{
    id: string;
    role: string;
    body_md: string;
    author_member_id: string | null;
    created_at: string;
    tool_calls: unknown;
    citations: unknown;
    model: string | null;
  }>;
  // Resolve author names in one round trip.
  const memberIds = Array.from(
    new Set(rows.map((r) => r.author_member_id).filter((v): v is string => !!v)),
  );
  const nameById = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: members } = await service
      .schema('app')
      .from('member')
      .select('id, display_name')
      .in('id', memberIds);
    for (const m of (members ?? []) as Array<{ id: string; display_name: string }>) {
      nameById.set(m.id, m.display_name);
    }
  }
  return {
    conversation: { id: conv.id, title: conv.title, last_message_at: conv.last_message_at },
    turns: rows.map((r) => ({
      ...r,
      author_display_name: r.author_member_id ? (nameById.get(r.author_member_id) ?? null) : null,
    })),
  };
}
