/**
 * Financial segment sub-navigation.
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
  href:
    | '/financial'
    | '/financial/transactions'
    | '/financial/accounts'
    | '/financial/budgets'
    | '/financial/subscriptions'
    | '/financial/calendar'
    | '/financial/summaries'
    | '/financial/alerts';
}

const TABS: Tab[] = [
  { label: 'Overview', href: '/financial' },
  { label: 'Transactions', href: '/financial/transactions' },
  { label: 'Accounts', href: '/financial/accounts' },
  { label: 'Budgets', href: '/financial/budgets' },
  { label: 'Subscriptions', href: '/financial/subscriptions' },
  { label: 'Calendar', href: '/financial/calendar' },
  { label: 'Summaries', href: '/financial/summaries' },
  { label: 'Alerts', href: '/financial/alerts' },
];

export function FinancialSubNav() {
  const pathname = usePathname() ?? '/financial';

  return (
    <nav
      aria-label="Financial sections"
      className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1 text-sm"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === '/financial' ? pathname === '/financial' : pathname.startsWith(tab.href);
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
