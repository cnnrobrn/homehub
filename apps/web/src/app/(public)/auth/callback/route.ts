/**
 * OAuth / magic-link callback.
 *
 * Supabase sends both Google OAuth and email-OTP redirects here with a
 * `?code=...` query parameter. We exchange the code for a session (which
 * sets the `sb-*` cookie through `@supabase/ssr`) and then redirect to
 * the `next` path if present, otherwise to `/` (the authenticated home).
 *
 * If the user has no household yet, the `(app)` layout's post-auth
 * redirect will push them to `/onboarding`.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { createClient as createSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function safeNext(next: string | null): string {
  if (!next) return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  if (next.includes('\\')) return '/';
  return next;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (!code) {
    // No code — this can happen if a user hits the URL directly.
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
