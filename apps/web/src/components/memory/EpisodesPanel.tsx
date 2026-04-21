/**
 * Time-ordered episodes that reference this node.
 *
 * Server Component. Episodes coming from `source_type='event'`
 * deep-link to the unified calendar; other source types render
 * metadata inline.
 */

import { Calendar, CreditCard, Mail, MessageSquare, UtensilsCrossed } from 'lucide-react';
import Link from 'next/link';

import { type EpisodeRow } from '@/lib/memory/query';

const ICONS = {
  event: Calendar,
  email: Mail,
  meal: UtensilsCrossed,
  transaction: CreditCard,
  conversation: MessageSquare,
} as const;

function Icon({ sourceType }: { sourceType: string }) {
  const Component = (ICONS as Record<string, typeof Calendar | undefined>)[sourceType] ?? Calendar;
  return <Component className="h-4 w-4 text-fg-muted" aria-hidden="true" />;
}

export interface EpisodesPanelProps {
  episodes: EpisodeRow[];
}

export function EpisodesPanel({ episodes }: EpisodesPanelProps) {
  if (episodes.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-4 text-sm text-fg-muted">
        No episodes linked to this node yet.
      </p>
    );
  }
  return (
    <ol
      className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface"
      aria-label="Episodes"
    >
      {episodes.map((ep) => {
        const occurred = new Date(ep.occurred_at);
        const dateStr = occurred.toLocaleDateString(undefined, {
          dateStyle: 'medium',
        });
        const isEvent = ep.source_type === 'event';
        const day = occurred.toISOString().slice(0, 10);
        return (
          <li key={ep.id} className="flex items-start gap-3 px-3 py-2 text-sm">
            <Icon sourceType={ep.source_type} />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="flex items-center gap-2 font-medium text-fg">
                <span className="truncate">{ep.title}</span>
                <span className="text-xs uppercase tracking-wide text-fg-muted">
                  {ep.source_type}
                </span>
              </p>
              {ep.summary ? <p className="truncate text-xs text-fg-muted">{ep.summary}</p> : null}
            </div>
            <div className="text-right text-xs text-fg-muted tabular-nums">
              <time dateTime={ep.occurred_at}>{dateStr}</time>
              {isEvent ? (
                <div>
                  <Link
                    href={`/calendar?cursor=${day}` as never}
                    className="text-accent hover:underline"
                  >
                    Open in calendar
                  </Link>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
