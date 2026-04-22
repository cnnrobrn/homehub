/**
 * `/chat` — index page.
 *
 * Shows the conversation sidebar on the left and a calm center pane
 * prompting the member to start a conversation. When at least one
 * conversation exists we redirect to the most recent; this page is
 * only ever the first-run / empty state for a household.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { HomeHubMark, WarmButton } from '@/components/design-system';
import { requireHouseholdContext } from '@/lib/auth/context';
import { listConversationsForHousehold } from '@/lib/chat/loadConversations';

export default async function ChatIndexPage() {
  const ctx = await requireHouseholdContext();
  const conversations = await listConversationsForHousehold(ctx.household.id as string);

  if (conversations.length > 0) {
    redirect(`/chat/${conversations[0]!.id}`);
  }

  return (
    <div className="flex h-[calc(100svh-3.5rem)] bg-bg">
      <ChatSidebar conversations={conversations} />
      <section className="flex min-w-0 flex-1 items-center justify-center px-10 py-12">
        <div className="flex max-w-[460px] flex-col items-center gap-4 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-fg">
            <HomeHubMark size={18} />
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-muted">
            a quiet place to think out loud
          </div>
          <h1 className="m-0 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em]">
            start a conversation.
          </h1>
          <p className="m-0 text-[15px] leading-[1.6] text-fg-muted">
            ask about this week, your spend, a dish you haven&apos;t had in a while, or who&apos;s
            free saturday. the house remembers so you don&apos;t have to.
          </p>
          <Link href="/chat/new" className="no-underline">
            <WarmButton variant="primary" size="md">
              new chat
            </WarmButton>
          </Link>
        </div>
      </section>
    </div>
  );
}
