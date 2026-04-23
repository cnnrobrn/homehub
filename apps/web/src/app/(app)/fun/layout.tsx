/**
 * Fun-segment shell layout.
 *
 * Server Component. Gates every page beneath `/fun` on `fun:read` in
 * the member's segment grants. Renders a stub with guidance when the
 * member lacks access rather than redirecting.
 */

import Link from 'next/link';

import type { ReactNode } from 'react';

import { FunSubNav } from '@/components/fun/FunSubNav';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import { hasFunRead, type SegmentGrant } from '@/lib/fun';
import { getVisibleSetupHrefs } from '@/lib/onboarding/setup';

export const metadata = {
  title: 'Fun — HomeHub',
};

export default async function FunLayout({ children }: { children: ReactNode }) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  if (!hasFunRead(grants)) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Fun</h1>
          <p className="text-sm text-fg-muted">
            You don&apos;t have access to fun data for this household.
          </p>
        </header>
        <div
          role="alert"
          className={cn(
            'flex flex-col gap-2 rounded-lg border border-border bg-surface p-6 text-sm text-fg-muted',
          )}
        >
          <p>Ask an owner to grant you the Fun read permission.</p>
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

  const visibleHrefs = getVisibleSetupHrefs(ctx.household.settings, 'fun');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Fun</h1>
        <p className="text-sm text-fg-muted">
          Trips, hobbies, outings, reservations, and your household queue.
        </p>
      </header>
      {visibleHrefs ? <FunSubNav visibleHrefs={visibleHrefs} /> : <FunSubNav />}
      {children}
    </div>
  );
}
