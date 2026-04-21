/**
 * Left navigation sidebar.
 *
 * Server Component. The nav tree is static for M1 — Settings and Memory
 * are reachable, everything else is disabled with a tooltip label so the
 * user sees the shape of the product.
 */

import {
  BookOpen,
  Calendar,
  CircleDollarSign,
  Cog,
  LayoutDashboard,
  MessageSquare,
  PartyPopper,
  Users,
  Utensils,
} from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface NavItem {
  label: string;
  icon: ReactNode;
  href?: string;
  disabled?: boolean;
  disabledLabel?: string;
}

const NAV: NavItem[] = [
  { label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, href: '/' },
  { label: 'Chat', icon: <MessageSquare className="h-4 w-4" />, href: '/chat' },
  { label: 'Calendar', icon: <Calendar className="h-4 w-4" />, href: '/calendar' },
  {
    label: 'Financial',
    icon: <CircleDollarSign className="h-4 w-4" />,
    href: '/financial',
  },
  { label: 'Food', icon: <Utensils className="h-4 w-4" />, href: '/food' },
  { label: 'Fun', icon: <PartyPopper className="h-4 w-4" />, href: '/fun' },
  { label: 'Social', icon: <Users className="h-4 w-4" />, href: '/social' },
  { label: 'Memory', icon: <BookOpen className="h-4 w-4" />, href: '/memory' },
  { label: 'Settings', icon: <Cog className="h-4 w-4" />, href: '/settings/household' },
];

export function AppSidebar() {
  return (
    <aside
      aria-label="Primary navigation"
      className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex"
    >
      <Link
        href="/"
        className="mb-6 rounded-md px-2 py-1 text-lg font-semibold tracking-tight hover:bg-bg/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        HomeHub
      </Link>
      <nav className="flex flex-col gap-1" aria-label="Sections">
        {NAV.map((item) => (
          <NavLink key={item.label} item={item} />
        ))}
      </nav>
    </aside>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const base =
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

  if (item.disabled || !item.href) {
    return (
      <span
        className={cn(base, 'cursor-not-allowed text-fg-muted/60')}
        title={item.disabledLabel}
        aria-disabled="true"
      >
        {item.icon}
        <span>{item.label}</span>
        <span className="sr-only">{` — ${item.disabledLabel ?? 'disabled'}`}</span>
      </span>
    );
  }

  return (
    <Link
      // The href literal is typed against the app's route tree via Next's
      // `typedRoutes` setting.
      href={item.href as never}
      className={cn(base, 'text-fg hover:bg-bg/50')}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}
