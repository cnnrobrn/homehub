/**
 * Secondary nav for /settings/*.
 *
 * Client Component so the `aria-current="page"` marker follows the
 * active route. Memory, notifications, and connections render as
 * disabled rows with tooltips — their pages ship in M2+/M9.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

interface NavItem {
  label: string;
  href?: string;
  disabled?: boolean;
  disabledLabel?: string;
}

const ITEMS: NavItem[] = [
  { label: 'Household', href: '/settings/household' },
  { label: 'Members', href: '/settings/members' },
  { label: 'Connections', href: '/settings/connections' },
  {
    label: 'Notifications',
    disabled: true,
    disabledLabel: 'Available in M9',
  },
  {
    label: 'Memory',
    disabled: true,
    disabledLabel: 'Available in M3',
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-1">
      {ITEMS.map((item) => {
        if (item.disabled || !item.href) {
          return (
            <span
              key={item.label}
              className="rounded-md px-3 py-1.5 text-sm text-fg-muted/60"
              title={item.disabledLabel}
              aria-disabled="true"
            >
              {item.label}
              <span className="sr-only">{` — ${item.disabledLabel ?? 'disabled'}`}</span>
            </span>
          );
        }
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.label}
            href={item.href as never}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              active ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface hover:text-fg',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
