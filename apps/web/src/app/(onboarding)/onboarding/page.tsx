/**
 * `/onboarding` — first-run household setup.
 *
 * A signed-in user with no household lands here. Two tabs:
 *   - Create a household (name + optional tz/currency).
 *   - Paste an invite link or token.
 *
 * The shell already redirected away from `/` so we don't need to check
 * the household context here — but if the user *does* have a household
 * (e.g. they arrived via an old bookmark), bounce to `/`.
 */

import { redirect } from 'next/navigation';

import { OnboardingForm } from '@/components/auth/OnboardingForm';
import { getHouseholdContext } from '@/lib/auth/context';

export default async function OnboardingPage() {
  const ctx = await getHouseholdContext();
  if (ctx) redirect('/');

  return (
    <div className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to HomeHub</h1>
        <p className="text-sm text-fg-muted">
          Create a household to get started, or paste an invite to join an existing one.
        </p>
      </div>
      <OnboardingForm />
    </div>
  );
}
