/**
 * Social segment sub-navigation.
 *
 * Client Component — uses `usePathname` to highlight the active tab.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

interface Tab {
  label: string;
  href:
    | '/social'
    | '/social/people'
    | '/social/groups'
    | '/social/calendar'
    | '/social/summaries'
    | '/social/alerts';
}

const TABS: Tab[] = [
  { label: 'Overview', href: '/social' },
  { label: 'People', href: '/social/people' },
  { label: 'Groups', href: '/social/groups' },
  { label: 'Calendar', href: '/social/calendar' },
  { label: 'Summaries', href: '/social/summaries' },
  { label: 'Alerts', href: '/social/alerts' },
];

export function SocialSubNav({ visibleHrefs }: { visibleHrefs?: readonly string[] }) {
  const pathname = usePathname() ?? '/social';
  const tabs = visibleHrefs
    ? TABS.filter((tab) => tab.href === '/social' || visibleHrefs.includes(tab.href))
    : TABS;

  return (
    <nav
      aria-label="Social sections"
      className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1 text-sm"
    >
      {tabs.map((tab, index) => {
        const active =
          tab.href === '/social' ? pathname === '/social' : pathname.startsWith(tab.href);
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
