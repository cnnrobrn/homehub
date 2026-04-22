/**
 * Top bar on every authenticated page.
 *
 * Server Component wrapping a few thin client islands:
 *   - Household switcher (listHouseholdsAction → DropdownMenu radio)
 *   - User menu (sign out + email)
 *   - ⌘K placeholder button
 *
 * Receives the already-resolved household + user from the parent layout
 * so this component never touches Supabase directly.
 */

import type { Role } from '@homehub/auth-server';

import { listHouseholdsAction } from '@/app/actions/household';
import { CommandKLauncher } from '@/components/shell/CommandKLauncher';
import { HouseholdSwitcher } from '@/components/shell/HouseholdSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';

interface TopBarProps {
  householdName: string;
  householdId: string;
  userEmail: string | null;
  memberRole: Role;
}

export async function TopBar({ householdName, householdId, userEmail, memberRole }: TopBarProps) {
  const listRes = await listHouseholdsAction();
  const households = listRes.ok ? listRes.data : [];

  return (
    <header className="sticky top-0 z-10 flex h-[52px] items-center gap-3 border-b border-border bg-bg px-7">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:rounded-md focus:bg-accent focus:px-2 focus:py-1 focus:text-accent-fg"
      >
        Skip to main content
      </a>
      <HouseholdSwitcher
        activeId={householdId}
        activeName={householdName}
        households={households.map((h) => ({
          id: String(h.household.id),
          name: h.household.name,
          role: h.membership.role,
        }))}
      />
      <div className="flex-1" />
      <CommandKLauncher householdId={householdId} />
      <UserMenu email={userEmail} role={memberRole} />
    </header>
  );
}
