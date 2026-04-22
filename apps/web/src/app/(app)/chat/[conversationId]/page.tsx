/**
 * `/chat/[conversationId]` — active thread.
 *
 * Server Component. Loads the conversation + last 50 turns, passes
 * both into the client `ChatThread` component.
 *
 * Visual shell follows the V2 Indie "ask" layout: warm sidebar on the
 * left, a content column whose header is a calm mono eyebrow above
 * the conversation title. The actual message rendering lives in
 * `ChatThread`.
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

function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase();
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

  const title = thread.conversation.title ?? 'untitled';

  return (
    <div className="flex h-[calc(100svh-3.5rem)] bg-bg">
      <ChatSidebar conversations={conversations} activeConversationId={conversationId} />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border px-6 pt-6 pb-4 sm:px-12">
          <div className="mx-auto flex w-full max-w-[640px] items-baseline gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                ask · last updated {formatLastUpdated(thread.conversation.last_message_at)}
              </div>
              <h1 className="m-0 truncate text-[17px] font-semibold leading-[1.3] tracking-[-0.02em] text-fg">
                {title}
              </h1>
            </div>
          </div>
        </header>
        <ChatThread conversationId={conversationId} initialTurns={thread.turns} />
      </section>
    </div>
  );
}
