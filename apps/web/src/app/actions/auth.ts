/**
 * Authentication server actions.
 *
 * Thin wrappers over Supabase Auth's magic-link + OAuth flows. These
 * actions own cookie writes (Supabase SSR persists the session cookie
 * automatically through the shared cookie adapter) and the redirect
 * envelope — all business logic is already in the auth layer.
 *
 * Each action returns an `ActionResult<{ redirectTo? }>` so the client
 * component can call `router.push()` rather than doing a hard reload.
 */

'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { ACTIVE_HOUSEHOLD_COOKIE } from '@/lib/auth/context';
import { publicEnv } from '@/lib/env';
import { createClient as createSupabaseClient } from '@/lib/supabase/server';

const emailSchema = z.object({
  email: z.string().email(),
  next: z.string().optional(),
});

/**
 * Validates a `?next=…` parameter. We only permit internal paths (start
 * with `/`, no scheme, no `//`). Anything else falls back to `/`.
 */
function safeNextPath(next: string | null | undefined): string {
  if (!next) return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  if (next.includes('\\')) return '/';
  return next;
}

export async function signInWithEmailAction(
  input: z.input<typeof emailSchema>,
): Promise<ActionResult<{ sent: true }>> {
  try {
    const parsed = emailSchema.parse(input);
    const supabase = await createSupabaseClient();
    const nextPath = safeNextPath(parsed.next ?? null);
    const callbackUrl = `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.email,
      options: { emailRedirectTo: callbackUrl },
    });
    if (error) {
      return { ok: false, error: { code: 'AUTH', message: error.message } };
    }
    return ok({ sent: true });
  } catch (err) {
    return toErr(err);
  }
}

const googleSchema = z.object({
  next: z.string().optional(),
});

export async function signInWithGoogleAction(
  input: z.input<typeof googleSchema>,
): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const parsed = googleSchema.parse(input);
    const supabase = await createSupabaseClient();
    const nextPath = safeNextPath(parsed.next ?? null);
    const callbackUrl = `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl, skipBrowserRedirect: true },
    });
    if (error) {
      return { ok: false, error: { code: 'AUTH', message: error.message } };
    }
    if (!data?.url) {
      return { ok: false, error: { code: 'AUTH', message: 'no redirect url returned' } };
    }
    return ok({ redirectTo: data.url });
  } catch (err) {
    return toErr(err);
  }
}

export async function signOutAction(): Promise<ActionResult<{ ok: true }>> {
  try {
    const supabase = await createSupabaseClient();
    await supabase.auth.signOut();
    const store = await cookies();
    // Drop the household-pinner so the next signed-in user doesn't
    // inherit a stranger's active household.
    store.delete(ACTIVE_HOUSEHOLD_COOKIE);
    return ok({ ok: true });
  } catch (err) {
    return toErr(err);
  }
}

const setActiveSchema = z.object({
  householdId: z.string().uuid(),
});

export async function setActiveHouseholdAction(
  input: z.input<typeof setActiveSchema>,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const parsed = setActiveSchema.parse(input);
    const store = await cookies();
    store.set(ACTIVE_HOUSEHOLD_COOKIE, parsed.householdId, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      // 30 days — just a preference pinner, not an auth token.
      maxAge: 60 * 60 * 24 * 30,
    });
    return ok({ ok: true });
  } catch (err) {
    return toErr(err);
  }
}
