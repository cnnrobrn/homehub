/**
 * Financial-segment shell layout.
 *
 * Server Component. Gates every page beneath `/financial` on
 * `financial:read` in the member's segment grants — the UI hides
 * affordances members can't use (RLS is still the backstop). When a
 * member lacks access we render a stub with a link to
 * `/settings/members` instead of redirecting, so a tab click from an
 * owner shared with a guest still renders a graceful "no access"
 * state.
 *
 * Sub-nav is URL-driven and server-rendered; the active link is
 * resolved from `x-url`/`referer` on every request (same trick as the
 * app-layout path-echo fallback).
 */

import Link from 'next/link';

import type { ReactNode } from 'react';

import { FinancialSubNav } from '@/components/financial/FinancialSubNav';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import { hasFinancialRead, type SegmentGrant } from '@/lib/financial';

export const metadata = {
  title: 'Financial — HomeHub',
};

export default async function FinancialLayout({ children }: { children: ReactNode }) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  if (!hasFinancialRead(grants)) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Financial</h1>
          <p className="text-sm text-fg-muted">
            You don&apos;t have access to financial data for this household.
          </p>
        </header>
        <div
          role="alert"
          className={cn(
            'flex flex-col gap-2 rounded-lg border border-border bg-surface p-6 text-sm text-fg-muted',
          )}
        >
          <p>Ask an owner to grant you the Financial read permission.</p>
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
        <h1 className="text-2xl font-semibold tracking-tight">Financial</h1>
        <p className="text-sm text-fg-muted">
          Household ledger, balances, budgets, subscriptions, and alerts.
        </p>
      </header>
      <FinancialSubNav />
      {children}
    </div>
  );
}
