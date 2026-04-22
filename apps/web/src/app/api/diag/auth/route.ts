/**
 * Temporary production diagnostic for post-login 500. DELETE AFTER USE.
 *
 * Call from a logged-in browser tab so the session cookie is forwarded.
 * Re-runs each stage the `(app)/layout.tsx` exercises (authEnv resolve,
 * getUser, getHouseholdContext) inside a try/catch and returns the
 * specific error + first stack frames. No secret values are returned.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GATE = 'diag-4678d4bb';

function errShape(e: unknown) {
  if (e instanceof Error) {
    return {
      name: e.constructor.name,
      message: e.message,
      stack: e.stack?.split('\n').slice(0, 10),
    };
  }
  return { name: 'unknown', message: String(e) };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('k') !== GATE) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const result: Record<string, unknown> = {};

  // Stage 1 — authEnv() full server-env resolve
  try {
    const { authEnv } = await import('@/lib/auth/env');
    const env = authEnv();
    result.authEnv = {
      ok: true,
      keys: Object.keys(env).sort(),
      INVITATION_TTL_DAYS: env.INVITATION_TTL_DAYS ?? null,
    };
  } catch (e) {
    result.authEnv = { ok: false, ...errShape(e) };
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  }

  // Stage 2 — cookie adapter
  try {
    const { nextCookieAdapter } = await import('@/lib/auth/cookies');
    const cookies = await nextCookieAdapter();
    const all = await cookies.getAll?.();
    result.cookies = {
      ok: true,
      count: all?.length ?? null,
      sbNames: all?.filter((c) => c.name.startsWith('sb-')).map((c) => c.name) ?? 'no-getAll',
    };
  } catch (e) {
    result.cookies = { ok: false, ...errShape(e) };
  }

  // Stage 3 — getUser
  try {
    const { getUser } = await import('@homehub/auth-server');
    const { authEnv } = await import('@/lib/auth/env');
    const { nextCookieAdapter } = await import('@/lib/auth/cookies');
    const user = await getUser(authEnv(), await nextCookieAdapter());
    result.getUser = user
      ? { ok: true, signedIn: true, userId: user.id.slice(0, 8) + '…', email: user.email }
      : { ok: true, signedIn: false };
  } catch (e) {
    result.getUser = { ok: false, ...errShape(e) };
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  }

  // Stage 4 — getHouseholdContext
  try {
    const { getHouseholdContext } = await import('@/lib/auth/context');
    const ctx = await getHouseholdContext();
    result.getHouseholdContext = ctx
      ? {
          ok: true,
          hasContext: true,
          householdId: ctx.household.id,
          householdName: ctx.household.name,
          memberRole: ctx.member.role,
          grantCount: ctx.grants.length,
        }
      : { ok: true, hasContext: false };
  } catch (e) {
    result.getHouseholdContext = { ok: false, ...errShape(e) };
  }

  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
