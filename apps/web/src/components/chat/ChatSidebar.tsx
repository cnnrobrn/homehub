/**
 * Server-rendered conversation list for `/chat`.
 *
 * Groups conversations into "today", "this week", "earlier" by
 * `last_message_at`. Visual language mirrors the V2 Indie design —
 * mono-uppercase group eyebrows, hairline dividers, a single ink
 * accent for the active row, and a calm "+ new" link in the header.
 */

import Link from 'next/link';

import type { ConversationListRow } from '@/lib/chat/loadConversations';

import { Eyebrow } from '@/components/design-system';
import { cn } from '@/lib/cn';

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

function formatRowDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
}

interface ChatSidebarProps {
  conversations: ConversationListRow[];
  activeConversationId?: string | null;
}

const BUCKET_LABEL: Record<'today' | 'week' | 'earlier', string> = {
  today: 'today',
  week: 'earlier this week',
  earlier: 'earlier',
};

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
      className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface-soft"
      aria-label="Conversation list"
    >
      <div className="flex items-center justify-between gap-2 px-5 pt-6 pb-3">
        <Eyebrow>chats</Eyebrow>
        <Link
          href="/chat/new"
          className="rounded-[3px] border border-border bg-surface px-2 py-0.5 font-mono text-[10.5px] tracking-[0.04em] text-fg-muted transition-colors hover:bg-surface-note hover:text-fg"
        >
          + new
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {(['today', 'week', 'earlier'] as const).map((key) => {
          const items = groups[key];
          if (items.length === 0) return null;
          return (
            <div key={key} className="mt-4 first:mt-1">
              <div className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                {BUCKET_LABEL[key]}
              </div>
              <ul className="flex flex-col">
                {items.map((c) => {
                  const isActive = c.id === activeConversationId;
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/chat/${c.id}`}
                        className={cn(
                          'grid grid-cols-[38px_1fr] items-baseline gap-2 rounded-[3px] px-3 py-2 transition-colors',
                          isActive
                            ? 'bg-surface text-fg shadow-[inset_2px_0_0_var(--color-accent)]'
                            : 'text-fg-muted hover:bg-surface hover:text-fg',
                        )}
                      >
                        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">
                          {formatRowDate(c.last_message_at)}
                        </span>
                        <span className="truncate text-[13px] leading-[1.4]">
                          {c.title ?? 'untitled'}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {conversations.length === 0 ? (
          <div className="px-3 py-5 text-[12.5px] leading-[1.5] text-fg-muted">
            no conversations yet. start one and it&apos;ll land here.
          </div>
        ) : null}
      </div>
    </aside>
  );
}
