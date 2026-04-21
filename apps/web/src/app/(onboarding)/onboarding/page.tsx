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
 *
 * Visual language mirrors `/login`: lowercase wordmark, mono eyebrow,
 * calm copy — the unauthenticated surfaces share one hand.
 */

import { redirect } from 'next/navigation';

import { OnboardingForm } from '@/components/auth/OnboardingForm';
import { HomeHubMark } from '@/components/design-system';
import { getHouseholdContext } from '@/lib/auth/context';

export default async function OnboardingPage() {
  const ctx = await getHouseholdContext();
  if (ctx) redirect('/');

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[460px] flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <HomeHubMark size={18} className="text-fg" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">homehub</span>
        </div>
        <div className="flex flex-col gap-3">
          <div className="font-mono text-[11px] tracking-[1px] text-fg-muted">
            {'// SET UP YOUR HOUSEHOLD'}
          </div>
          <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.5px] text-balance">
            start a household, or join one.
          </h1>
          <p className="max-w-[380px] text-[14px] leading-[1.55] text-fg-muted">
            Create a fresh household to get going, or paste an invite from someone already inside.
          </p>
        </div>
      </div>
      <OnboardingForm />
    </div>
  );
}
