/**
 * Food-segment shell layout.
 *
 * Server Component. Gates every page beneath `/food` on `food:read`.
 * Members without access see a graceful fallback that links them to
 * the settings page.
 */

import Link from 'next/link';

import type { ReactNode } from 'react';

import { FoodSubNav } from '@/components/food/FoodSubNav';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import { hasFoodRead, type SegmentGrant } from '@/lib/food';

export const metadata = {
  title: 'Food — HomeHub',
};

export default async function FoodLayout({ children }: { children: ReactNode }) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  if (!hasFoodRead(grants)) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Food</h1>
          <p className="text-sm text-fg-muted">
            You don&apos;t have access to food data for this household.
          </p>
        </header>
        <div
          role="alert"
          className={cn(
            'flex flex-col gap-2 rounded-lg border border-border bg-surface p-6 text-sm text-fg-muted',
          )}
        >
          <p>Ask an owner to grant you the Food read permission.</p>
          <p>
            <Link
              href="/settings/members"
              className="text-accent underline underline-offset-2 hover:no-underline"
            >
              Open member settings
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Food</h1>
        <p className="text-sm text-fg-muted">
          Meals, pantry, grocery orders, dishes, summaries, and alerts.
        </p>
      </header>
      <FoodSubNav />
      {children}
    </div>
  );
}
