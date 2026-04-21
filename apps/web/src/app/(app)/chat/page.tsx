/**
 * `/chat` — index page.
 *
 * Shows the conversation sidebar on the left and an empty center
 * column prompting the member to pick or start a conversation. When
 * there's at least one conversation, we preselect the most recent.
 */

import { redirect } from 'next/navigation';

import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { requireHouseholdContext } from '@/lib/auth/context';
import { listConversationsForHousehold } from '@/lib/chat/loadConversations';

export default async function ChatIndexPage() {
  const ctx = await requireHouseholdContext();
  const conversations = await listConversationsForHousehold(ctx.household.id as string);

  if (conversations.length > 0) {
    redirect(`/chat/${conversations[0]!.id}`);
  }

  return (
    <div className="flex h-[calc(100svh-3.5rem)]">
      <ChatSidebar conversations={conversations} />
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <h1 className="text-xl font-semibold">Start a conversation</h1>
        <p className="mt-2 max-w-md text-sm text-fg-muted">
          HomeHub learns as you use it. Ask about this week, your spend, a dish you haven’t had in a
          while, or who’s free Saturday.
        </p>
        <a
          href="/chat/new"
          className="mt-4 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-fg"
        >
          New chat
        </a>
      </div>
    </div>
  );
}
