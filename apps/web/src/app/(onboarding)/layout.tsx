/**
 * Onboarding route group layout.
 *
 * Enforces a valid session but does NOT require household context — the
 * `/onboarding` page exists specifically to let a freshly-signed-in user
 * create or join a household. Placing it outside the `(app)` route group
 * avoids a redirect loop (layout says "no household → /onboarding"; we
 * need the page to actually render when that happens).
 */

import { getUser } from '@homehub/auth-server';
import { redirect } from 'next/navigation';

import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/toaster';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const cookies = await nextCookieAdapter();
  const env = authEnv();
  const user = await getUser(env, cookies);
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-svh bg-bg text-fg">
      {children}
      <Toaster />
    </div>
  );
}
