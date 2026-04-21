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
 * collects credentials.
 */

import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  // Normalize the `next` here — the form is a client component and we
  // don't want it to trust whatever URL the browser sent. Same shape as
  // `safeNextPath` in the server action but scoped to this page; the
  // server action re-validates on submit, so this is belt + braces.
  const nextPath =
    next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">HomeHub</h1>
        <p className="text-sm text-fg-muted">Sign in to your household.</p>
      </div>
      <LoginForm next={nextPath} />
    </div>
  );
}
