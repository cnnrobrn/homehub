/**
 * `/chat/[conversationId]` — active thread.
 *
 * Server Component. Loads the conversation + last 50 turns, passes
 * both into the client `ChatThread` component.
 */

import { notFound } from 'next/navigation';

import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatThread } from '@/components/chat/ChatThread';
import { requireHouseholdContext } from '@/lib/auth/context';
import {
  listConversationsForHousehold,
  loadConversationThread,
} from '@/lib/chat/loadConversations';

interface PageProps {
  params: Promise<{ conversationId: string }>;
}

export default async function ChatConversationPage({ params }: PageProps) {
  const ctx = await requireHouseholdContext();
  const { conversationId } = await params;

  const [conversations, thread] = await Promise.all([
    listConversationsForHousehold(ctx.household.id as string),
    loadConversationThread({
      householdId: ctx.household.id as string,
      conversationId,
    }),
  ]);

  if (!thread.conversation) notFound();

  return (
    <div className="flex h-[calc(100svh-3.5rem)]">
      <ChatSidebar conversations={conversations} activeConversationId={conversationId} />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2">
          <h1 className="truncate text-sm font-semibold">
            {thread.conversation.title ?? 'Untitled conversation'}
          </h1>
          <span className="text-xs text-fg-muted">
            last updated {new Date(thread.conversation.last_message_at).toLocaleString()}
          </span>
        </header>
        <ChatThread conversationId={conversationId} initialTurns={thread.turns} />
      </section>
    </div>
  );
}
