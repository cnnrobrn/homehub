/**
 * Household switcher. Shown in the top bar; collapses to a read-only label
 * when the user belongs to exactly one household.
 *
 * Selecting a row calls `setActiveHouseholdAction`, which sets a cookie
 * the layout's `getHouseholdContext()` reads on the next render. After
 * the mutation we call `router.refresh()` so every server-rendered page
 * re-resolves the household.
 */

'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { setActiveHouseholdAction } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';

interface HouseholdOption {
  id: string;
  name: string;
  role: string;
}

interface HouseholdSwitcherProps {
  activeId: string;
  activeName: string;
  households: HouseholdOption[];
}

export function HouseholdSwitcher({ activeId, activeName, households }: HouseholdSwitcherProps) {
  const router = useRouter();
  const [pending, start] = React.useTransition();

  // Single household — no need for a menu.
  if (households.length <= 1) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-fg">{activeName}</span>
      </div>
    );
  }

  function onSelect(id: string) {
    if (id === activeId) return;
    start(async () => {
      const res = await setActiveHouseholdAction({ householdId: id });
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not switch household',
          description: res.error.message,
        });
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          aria-label={`Switch household (currently ${activeName})`}
          disabled={pending}
        >
          <span className="font-medium">{activeName}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Your households</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {households.map((h) => (
          <DropdownMenuItem
            key={h.id}
            onSelect={() => onSelect(h.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex flex-col">
              <span className="text-sm">{h.name}</span>
              <span className="text-xs text-fg-muted">{h.role}</span>
            </span>
            {h.id === activeId ? (
              <Check className="h-4 w-4 text-accent" aria-label="Active" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
