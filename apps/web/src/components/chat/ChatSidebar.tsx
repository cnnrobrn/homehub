/**
 * Server-rendered conversation list for `/chat`.
 *
 * Groups conversations into "Today", "This week", "Earlier" by
 * `last_message_at`. Each row links to the active-thread page.
 */

import Link from 'next/link';

import type { ConversationListRow } from '@/lib/chat/loadConversations';

function bucket(dateIso: string, now: Date): 'today' | 'week' | 'earlier' {
  const d = new Date(dateIso);
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  if (d.getTime() >= todayMidnight.getTime()) return 'today';
  const weekAgo = new Date(todayMidnight);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (d.getTime() >= weekAgo.getTime()) return 'week';
  return 'earlier';
}

interface ChatSidebarProps {
  conversations: ConversationListRow[];
  activeConversationId?: string | null;
}

export function ChatSidebar({ conversations, activeConversationId }: ChatSidebarProps) {
  const now = new Date();
  const groups: Record<'today' | 'week' | 'earlier', ConversationListRow[]> = {
    today: [],
    week: [],
    earlier: [],
  };
  for (const c of conversations) {
    groups[bucket(c.last_message_at, now)].push(c);
  }

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface"
      aria-label="Conversation list"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <span>Chats</span>
        <Link
          href="/chat/new"
          className="rounded-md border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-accent hover:text-accent-fg"
        >
          + new
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(['today', 'week', 'earlier'] as const).map((key) => {
          const items = groups[key];
          if (items.length === 0) return null;
          return (
            <div key={key} className="py-2">
              <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-fg-muted">
                {key === 'today' ? 'Today' : key === 'week' ? 'This week' : 'Earlier'}
              </div>
              <ul>
                {items.map((c) => {
                  const isActive = c.id === activeConversationId;
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/chat/${c.id}`}
                        className={`block truncate px-3 py-1.5 text-sm ${
                          isActive
                            ? 'bg-accent/60 text-fg'
                            : 'text-fg-muted hover:bg-accent/20 hover:text-fg'
                        }`}
                      >
                        {c.title ?? 'Untitled'}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {conversations.length === 0 ? (
          <div className="px-3 py-4 text-xs text-fg-muted">No conversations yet.</div>
        ) : null}
      </div>
    </aside>
  );
}
