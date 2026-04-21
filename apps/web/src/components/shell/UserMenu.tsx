/**
 * Signed-in user menu. The only real action wired today is sign-out.
 * More entries (profile, help, dark/light toggle) land when the
 * relevant features exist.
 */

'use client';

import { LogOut, UserCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { signOutAction } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu({ email, role }: { email: string | null; role: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();

  function signOut() {
    start(async () => {
      await signOutAction();
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open user menu" disabled={pending}>
          <UserCircle2 className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="flex flex-col">
            <span className="truncate text-sm">{email ?? 'Signed in'}</span>
            <span className="text-xs text-fg-muted">Role: {role}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="gap-2">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
