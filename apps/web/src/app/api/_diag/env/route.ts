/**
 * Temporary production diagnostic. DELETE AFTER USE.
 *
 * Runs the same imports and client-creation the failing server action
 * triggers, inside a try/catch, and returns the real error message +
 * first stack frames. Gated by a shared-secret query param so it can't
 * be probed by randos. Reports only PRESENCE and FIRST/LAST CHARACTERS
 * of env values — never full secrets.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GATE = 'diag-4678d4bb';

function summarize(v: string | undefined): string {
  if (v === undefined) return 'undefined';
  if (v === '') return 'empty';
  if (v.length <= 6) return `len=${v.length} (short)`;
  return `len=${v.length} head=${v.slice(0, 4)}… tail=…${v.slice(-4)}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('k') !== GATE) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const result: Record<string, unknown> = {};

  // Stage 1 — raw process.env presence
  result.processEnv = {
    NEXT_PUBLIC_APP_URL: summarize(process.env.NEXT_PUBLIC_APP_URL),
    NEXT_PUBLIC_SUPABASE_URL: summarize(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: summarize(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: summarize(process.env.SUPABASE_SERVICE_ROLE_KEY),
    INVITATION_TOKEN_SECRET: summarize(process.env.INVITATION_TOKEN_SECRET),
    OPENROUTER_API_KEY: summarize(process.env.OPENROUTER_API_KEY),
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    NEXT_PHASE: process.env.NEXT_PHASE ?? null,
  };

  // Stage 2 — try module-level publicEnv load
  try {
    const mod = await import('@/lib/env');
    result.publicEnv = {
      ok: true,
      NEXT_PUBLIC_APP_URL: summarize(mod.publicEnv.NEXT_PUBLIC_APP_URL),
      NEXT_PUBLIC_SUPABASE_URL: summarize(mod.publicEnv.NEXT_PUBLIC_SUPABASE_URL),
    };
  } catch (e) {
    result.publicEnv = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.split('\n').slice(0, 8) : null,
    };
  }

  // Stage 3 — try creating the supabase server client
  try {
    const sb = await import('@/lib/supabase/server');
    const client = await sb.createClient();
    result.supabaseClient = {
      ok: true,
      hasAuth: typeof client.auth?.signInWithOAuth === 'function',
    };
  } catch (e) {
    result.supabaseClient = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.split('\n').slice(0, 8) : null,
    };
  }

  // Stage 4 — try the real OAuth signInWithOAuth call
  try {
    const sb = await import('@/lib/supabase/server');
    const client = await sb.createClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });
    result.signInWithOAuth = {
      ok: !error,
      errorMessage: error?.message ?? null,
      hasRedirectUrl: Boolean(data?.url),
      redirectHost: data?.url ? new URL(data.url).host : null,
    };
  } catch (e) {
    result.signInWithOAuth = {
      ok: false,
      threw: true,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.split('\n').slice(0, 8) : null,
    };
  }

  return NextResponse.json(result, {
    headers: { 'cache-control': 'no-store' },
  });
}
