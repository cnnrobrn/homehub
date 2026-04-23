/**
 * Fun segment sub-navigation.
 *
 * Client Component — uses `usePathname` to highlight the active tab
 * without round-tripping the server on navigation.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

interface Tab {
  label: string;
  href: '/fun' | '/fun/trips' | '/fun/queue' | '/fun/calendar' | '/fun/summaries' | '/fun/alerts';
}

const TABS: Tab[] = [
  { label: 'Overview', href: '/fun' },
  { label: 'Trips', href: '/fun/trips' },
  { label: 'Queue', href: '/fun/queue' },
  { label: 'Calendar', href: '/fun/calendar' },
  { label: 'Summaries', href: '/fun/summaries' },
  { label: 'Alerts', href: '/fun/alerts' },
];

export function FunSubNav({ visibleHrefs }: { visibleHrefs?: readonly string[] }) {
  const pathname = usePathname() ?? '/fun';
  const tabs = visibleHrefs
    ? TABS.filter((tab) => tab.href === '/fun' || visibleHrefs.includes(tab.href))
    : TABS;

  return (
    <nav
      aria-label="Fun sections"
      className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1 text-sm"
    >
      {tabs.map((tab, index) => {
        const active = tab.href === '/fun' ? pathname === '/fun' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={visibleHrefs ? { animationDelay: `${index * 30}ms` } : undefined}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-sm px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
              active ? 'bg-bg/80 text-fg' : 'text-fg-muted hover:bg-bg/50 hover:text-fg',
              visibleHrefs && 'hh-section-appear',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
