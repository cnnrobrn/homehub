/**
 * GET /api/oauth/google/start?provider=gcal&categories=receipt,bill
 *
 * Entry point for the native Google OAuth flow (replaces the Nango
 * `/api/integrations/connect?provider=google-*` path for these two
 * providers). For `ynab` and other providers, use the Nango route.
 *
 * Flow:
 *   1. Authenticate the current user + resolve household context.
 *   2. Pick scopes for the provider (gcal: fixed; gmail: derived from
 *      `categories`).
 *   3. Generate `state` + PKCE pair, persist to
 *      `sync.google_oauth_state` with a 10-minute expiry.
 *   4. Build the authorize URL via `createGoogleOAuthClient.getAuthUrl`
 *      with `access_type=offline&prompt=consent` baked in.
 *   5. 302 to Google.
 *
 * Errors: JSON 4xx rather than redirect. The popup-opener UI surfaces
 * them to the member.
 */

import { createServiceClient, getUser } from '@homehub/auth-server';
import {
  createGoogleOAuthClient,
  generatePkcePair,
  generateState,
  scopesForCalendar,
  scopesForGmail,
} from '@homehub/oauth-google';
import {
  ALL_EMAIL_CATEGORIES,
  isEmailCategory,
  type EmailCategory,
} from '@homehub/providers-email/client';
import { NextResponse, type NextRequest } from 'next/server';

import { getHouseholdContext } from '@/lib/auth/context';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

const ALLOWED_PROVIDERS = new Set(['gcal', 'gmail']);

export async function GET(request: NextRequest): Promise<Response> {
  const provider = request.nextUrl.searchParams.get('provider') ?? '';
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { error: `unsupported provider: ${provider || '<missing>'} (allowed: gcal, gmail)` },
      { status: 400 },
    );
  }

  let categories: EmailCategory[] = [];
  if (provider === 'gmail') {
    const raw = request.nextUrl.searchParams.get('categories') ?? '';
    categories = raw
      .split(',')
      .map((s) => s.trim())
      .filter(isEmailCategory);
    if (categories.length === 0) {
      return NextResponse.json(
        {
          error: 'gmail requires a `categories` opt-in list',
          allowed: ALL_EMAIL_CATEGORIES,
        },
        { status: 400 },
      );
    }
  }

  const env = serverEnv();
  if (
    !env.GOOGLE_OAUTH_CLIENT_ID ||
    !env.GOOGLE_OAUTH_CLIENT_SECRET ||
    !env.GOOGLE_OAUTH_REDIRECT_URI
  ) {
    return NextResponse.json({ error: 'google oauth not configured on server' }, { status: 503 });
  }

  const cookies = await nextCookieAdapter();
  const user = await getUser(authEnv(), cookies);
  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const ctx = await getHouseholdContext();
  if (!ctx) {
    return NextResponse.json(
      { error: 'no household context; complete onboarding first' },
      { status: 409 },
    );
  }

  const scopes = provider === 'gcal' ? scopesForCalendar() : scopesForGmail(categories);
  const state = generateState();
  const pkce = generatePkcePair();

  const service = createServiceClient(authEnv());
  const { error: insertErr } = await service
    .schema('sync' as never)
    .from('google_oauth_state' as never)
    .insert({
      state,
      code_verifier: pkce.codeVerifier,
      household_id: ctx.household.id,
      member_id: ctx.member.id,
      provider,
      requested_scopes: scopes,
      ...(categories.length > 0 ? { email_categories: categories } : {}),
    } as never);
  if (insertErr) {
    console.error('[oauth/google/start] failed to persist state row', insertErr);
    return NextResponse.json(
      { error: 'failed to initialize oauth state', detail: insertErr.message },
      { status: 500 },
    );
  }

  const oauth = createGoogleOAuthClient({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });
  const authUrl = oauth.getAuthUrl({
    state,
    codeChallenge: pkce.codeChallenge,
    scopes,
    ...(user.email ? { loginHint: user.email } : {}),
  });

  return NextResponse.redirect(authUrl, { status: 302 });
}
