/**
 * Food segment sub-navigation.
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
    | '/food'
    | '/food/meal-planner'
    | '/food/pantry'
    | '/food/groceries'
    | '/food/dishes'
    | '/food/calendar'
    | '/food/summaries'
    | '/food/alerts';
}

const TABS: Tab[] = [
  { label: 'Overview', href: '/food' },
  { label: 'Meal planner', href: '/food/meal-planner' },
  { label: 'Pantry', href: '/food/pantry' },
  { label: 'Groceries', href: '/food/groceries' },
  { label: 'Dishes', href: '/food/dishes' },
  { label: 'Calendar', href: '/food/calendar' },
  { label: 'Summaries', href: '/food/summaries' },
  { label: 'Alerts', href: '/food/alerts' },
];

export function FoodSubNav({ visibleHrefs }: { visibleHrefs?: readonly string[] }) {
  const pathname = usePathname() ?? '/food';
  const tabs = visibleHrefs
    ? TABS.filter((tab) => tab.href === '/food' || visibleHrefs.includes(tab.href))
    : TABS;
  return (
    <nav
      aria-label="Food sections"
      className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1 text-sm"
    >
      {tabs.map((tab) => {
        const active = tab.href === '/food' ? pathname === '/food' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-sm px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
              active ? 'bg-bg/80 text-fg' : 'text-fg-muted hover:bg-bg/50 hover:text-fg',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
