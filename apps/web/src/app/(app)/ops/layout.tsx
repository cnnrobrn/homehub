/**
 * `/ops/*` — internal operations surfaces.
 *
 * Every page under `(app)/ops/*` is **owner-only**. This layout re-checks
 * the caller's role in the current household context and renders a
 * "not found" shaped message for non-owners. That matches the spec
 * directive for operator surfaces: never reveal the existence of these
 * pages to members who cannot access them.
 *
 * The layout also draws a lightweight subnav for the three ops pages
 * (DLQ, model usage, health). No emojis and no external chart libs —
 * the surface is intentionally plain so server-render is cheap.
 */

import Link from 'next/link';

import type { ReactNode } from 'react';

import { requireHouseholdContext } from '@/lib/auth/context';

function NotFoundShape() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-fg-muted">The page you were looking for does not exist.</p>
    </div>
  );
}

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireHouseholdContext();
  if (ctx.member.role !== 'owner') {
    return <NotFoundShape />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
        <p className="text-sm text-fg-muted">
          Internal tools for {ctx.household.name}. Owner-only.
        </p>
      </header>
      <nav className="flex gap-4 border-b border-border pb-2 text-sm" aria-label="Ops sections">
        <Link href="/ops/dlq" className="hover:underline">
          Dead-letter queue
        </Link>
        <Link href="/ops/model-usage" className="hover:underline">
          Model usage
        </Link>
        <Link href="/ops/health" className="hover:underline">
          Health
        </Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
