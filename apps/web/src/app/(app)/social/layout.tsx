/**
 * Social-segment shell layout.
 *
 * Server Component. Gates every page beneath `/social` on
 * `social:read`.
 */

import Link from 'next/link';

import type { ReactNode } from 'react';

import { SocialSubNav } from '@/components/social/SocialSubNav';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import { getVisibleSetupHrefs } from '@/lib/onboarding/setup';
import { hasSocialRead, type SegmentGrant } from '@/lib/social';

export const metadata = {
  title: 'Social — HomeHub',
};

export default async function SocialLayout({ children }: { children: ReactNode }) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  if (!hasSocialRead(grants)) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Social</h1>
          <p className="text-sm text-fg-muted">
            You don&apos;t have access to social data for this household.
          </p>
        </header>
        <div
          role="alert"
          className={cn(
            'flex flex-col gap-2 rounded-lg border border-border bg-surface p-6 text-sm text-fg-muted',
          )}
        >
          <p>Ask an owner to grant you the Social read permission.</p>
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

  const visibleHrefs = getVisibleSetupHrefs(ctx.household.settings, 'social');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Social</h1>
        <p className="text-sm text-fg-muted">
          People, relationships, and the household&apos;s social calendar.
        </p>
      </header>
      {visibleHrefs ? <SocialSubNav visibleHrefs={visibleHrefs} /> : <SocialSubNav />}
      {children}
    </div>
  );
}
