/**
 * `/login` — HomeHub sign-in.
 *
 * Supports two flows per the spec (`specs/07-frontend/pages.md` § Auth):
 *   - Google OAuth (one-tap-style button → Supabase OAuth URL → callback)
 *   - Email magic link (`signInWithOtp` — Supabase sends a link, user
 *     clicks, callback exchanges the code for a session)
 *
 * The `?next=` search param is preserved through both flows so a user who
 * bounced off an auth-required page lands back on it after sign-in. The
 * server action validates that `next` is an internal path.
 *
 * Post-sign-in redirect logic lives in the `/auth/callback` route handler
 * since it's the one place that actually has a session; this page only
 * collects credentials. Visual language follows the marketing site's
 * indie-software system: lowercase wordmark, mono eyebrow, calm copy.
 */

import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/LoginForm';
import { HomeHubMark } from '@/components/design-system';

export const metadata: Metadata = {
  title: 'Sign in',
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  const nextPath =
    next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[380px] flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <HomeHubMark size={18} className="text-fg" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">homehub</span>
        </div>
        <div className="flex flex-col gap-3">
          <div className="font-mono text-[11px] tracking-[1px] text-fg-muted">{'// SIGN IN'}</div>
          <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.5px] text-balance">
            welcome back to your household.
          </h1>
          <p className="max-w-[320px] text-[14px] leading-[1.55] text-fg-muted">
            A link in your inbox is all it takes. No password, no fuss.
          </p>
        </div>
      </div>
      <LoginForm next={nextPath} />
      <div className="font-mono text-[11px] tracking-[0.5px] text-fg-muted">
        no password · signed in for 30 days
      </div>
    </div>
  );
}
