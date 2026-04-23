/**
 * Left navigation sidebar — V2 Indie direction.
 *
 * Warm-sand background, household identity header, Alfred launcher,
 * primary nav + "Parts of life" segment nav with colored dots, and a
 * footer with member avatars and a "quietly caught up" status line.
 */

import Link from 'next/link';

import type { SegmentId } from '@/components/design-system/segment';
import type { ReactNode } from 'react';

import { listMembersAction } from '@/app/actions/members';
import { HomeHubMark, MemberAvatar, SegDot } from '@/components/design-system';
import { SEGMENTS } from '@/components/design-system/segment';
import { OpenCommandK } from '@/components/shell/OpenCommandK';
import { ASSISTANT_NAME } from '@/lib/assistant';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import { getConfiguredSetupSegments } from '@/lib/onboarding/setup';

interface NavItem {
  label: string;
  href: string;
  /** When set, the row shows a small count badge on the right (accent pill). */
  count?: number;
}

const PRIMARY: NavItem[] = [
  { label: 'Today', href: '/' },
  { label: ASSISTANT_NAME, href: '/chat' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Decisions', href: '/suggestions' },
];

/** Friendly segment labels come from SEGMENTS; href matches the app routes. */
const SEG_HREF: Record<SegmentId, string> = {
  financial: '/financial',
  food: '/food',
  fun: '/fun',
  social: '/social',
};

function firstNamesList(names: string[]): string {
  const trimmed = names.map((n) => n.trim()).filter(Boolean);
  if (trimmed.length === 0) return '';
  if (trimmed.length === 1) return trimmed[0]!;
  if (trimmed.length === 2) return `${trimmed[0]} & ${trimmed[1]}`;
  return `${trimmed.slice(0, -1).join(', ')} & ${trimmed[trimmed.length - 1]}`;
}

export async function AppSidebar() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const membersRes = await listMembersAction({ householdId: ctx.household.id });
  const members = membersRes.ok ? membersRes.data : [];
  const memberNames = members.map((m) => m.displayName);
  const visibleSegments = getConfiguredSetupSegments(ctx.household.settings);

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden w-[228px] shrink-0 flex-col gap-0.5 border-r border-border bg-surface-soft px-3 py-5 md:flex"
    >
      <div className="mb-4 flex items-center gap-2.5 px-2.5 pb-3">
        <HomeHubMark size={18} className="text-fg" />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-fg">
            {ctx.household.name}
          </div>
          {memberNames.length > 0 ? (
            <div className="mt-[1px] truncate text-[11px] text-fg-muted">
              {firstNamesList(memberNames)}
            </div>
          ) : null}
        </div>
      </div>

      <OpenCommandK />

      <nav className="flex flex-col gap-0.5" aria-label="Sections">
        {PRIMARY.map((item) => (
          <NavRow
            key={item.label}
            href={item.href}
            {...(item.count != null ? { count: item.count } : {})}
          >
            {item.label}
          </NavRow>
        ))}
      </nav>

      {visibleSegments.length > 0 ? (
        <>
          <SidebarLabel>Parts of life</SidebarLabel>
          <nav className="flex flex-col gap-0.5" aria-label="Parts of life">
            {visibleSegments.map((id) => (
              <NavRow key={id} href={SEG_HREF[id]} dot={<SegDot segment={id} size={7} />}>
                {SEGMENTS[id].label}
              </NavRow>
            ))}
          </nav>
        </>
      ) : null}

      <SidebarLabel>Notebook</SidebarLabel>
      <NavRow href="/memory">What we know</NavRow>

      <div className="flex-1" />

      <div className="mt-3 flex items-center gap-2.5 px-2.5">
        <div className="flex">
          {members.slice(0, 4).map((m, i) => (
            <div key={m.id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
              <MemberAvatar name={m.displayName} size={22} />
            </div>
          ))}
        </div>
        <div className="text-[11px] text-fg-muted">
          {members.length === 1
            ? 'just you here'
            : members.length > 0
              ? `all ${members.length} here`
              : ''}
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-2 font-mono text-[11px] tracking-[0.01em] text-fg-muted">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--segment-financial)' }}
        />
        quietly caught up
      </div>

      <Link
        href="/settings/household"
        className="mt-1 rounded-[3px] px-2.5 py-1.5 text-[12px] text-fg-muted transition-colors hover:bg-bg/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-soft"
      >
        Settings
      </Link>
    </aside>
  );
}

function SidebarLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 mb-1 px-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
      {children}
    </div>
  );
}

function NavRow({
  href,
  children,
  count,
  dot,
}: {
  href: string;
  children: ReactNode;
  count?: number;
  dot?: ReactNode;
}) {
  // Active-state styling belongs on a client component (usePathname). The
  // V2 Indie sidebar intentionally stays calm — we let the hover/focus
  // rings carry the interaction affordance on the server pass.
  return (
    <Link
      href={href as never}
      className={cn(
        'flex items-center gap-2.5 rounded-[3px] px-2.5 py-[7px] text-[13.5px] text-fg-muted transition-colors',
        'hover:bg-bg/60 hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-soft',
      )}
    >
      {dot}
      <span className="flex-1">{children}</span>
      {count != null ? (
        <span
          className="rounded-full font-mono text-[10.5px] tracking-[0.02em] text-accent"
          style={{
            padding: '1px 7px',
            background: 'color-mix(in oklch, var(--color-accent) 12%, transparent)',
          }}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
