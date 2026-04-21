/**
 * Authenticated app shell.
 *
 * Resolves the current user + household context in one server pass.
 * Redirects:
 *   - no session → `/login?next=<this path>`
 *   - session but no household → `/onboarding`
 *
 * The layout renders the chrome (sidebar + top bar) around every page in
 * the `(app)` route group. Children receive the rendered surface; pages
 * themselves call `getHouseholdContext()` when they need the data — the
 * call is `cache()`-d so there's no extra round trip.
 *
 * Auth is enforced here via server-side redirects rather than via Next
 * middleware. Middleware would short-circuit before Server Components
 * render, but would also need to duplicate this env + cookie logic.
 * Keeping the enforcement in the layout means the auth-server package is
 * the single source of truth — see Ambiguities section of the dispatch
 * report for the tradeoff notes.
 */

import { getUser } from '@homehub/auth-server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { ReactNode } from 'react';

import { AppSidebar } from '@/components/shell/AppSidebar';
import { TopBar } from '@/components/shell/TopBar';
import { Toaster } from '@/components/ui/toaster';
import { getHouseholdContext } from '@/lib/auth/context';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';

async function resolveCurrentPath(): Promise<string> {
  const h = await headers();
  // Next's `x-invoke-path` is the server-side route with params expanded,
  // but the request-scoped URL header is more widely supported.
  const url = h.get('x-url') ?? h.get('referer') ?? '';
  if (!url) return '/';
  try {
    return new URL(url, 'http://local').pathname || '/';
  } catch {
    return '/';
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookies = await nextCookieAdapter();
  const env = authEnv();
  const user = await getUser(env, cookies);
  if (!user) {
    const pathname = await resolveCurrentPath();
    const nextParam = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    redirect(`/login${nextParam}`);
  }

  const context = await getHouseholdContext();
  if (!context) {
    redirect('/onboarding');
  }

  return (
    <div className="flex min-h-svh bg-bg text-fg">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          householdName={context.household.name}
          householdId={context.household.id}
          userEmail={user.email}
          memberRole={context.member.role}
        />
        <main id="main-content" className="flex-1 overflow-y-auto focus:outline-none" tabIndex={-1}>
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
