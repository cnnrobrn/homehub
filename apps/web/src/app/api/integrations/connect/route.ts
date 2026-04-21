/**
 * GET /api/integrations/connect?provider=google-calendar
 *
 * Mints a Nango Connect session scoped to `(household_id, member_id,
 * provider)` and redirects the browser to Nango's hosted-auth URL.
 *
 * Flow:
 *   1. Verify the current user has a household context.
 *   2. Call Nango `POST /connect/sessions` with:
 *        - `end_user.id` = `member:<member_id>` (stable HomeHub id).
 *        - `tags` = { household_id, member_id, provider } so the Nango
 *          webhook (handled by `apps/workers/webhook-ingest`) can route
 *          `connection.created` back to the right row.
 *        - `allowed_integrations` = [provider]
 *   3. 302 to the `connect_link` returned by Nango.
 *
 * Error shape: anything that fails resolution returns a 4xx JSON body
 * rather than redirecting — browsers render the JSON in the tab, which
 * is loud enough for a first-time member to report the issue.
 */

import { UnauthorizedError, getUser } from '@homehub/auth-server';
import { NextResponse, type NextRequest } from 'next/server';

import { getHouseholdContext } from '@/lib/auth/context';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';
import { NangoNotConfiguredError, createWebNangoClient } from '@/lib/nango/client';

export const dynamic = 'force-dynamic';

/**
 * The providers the connect route accepts. Keep this tight — each entry
 * here must correspond to a Nango integration configured in the admin UI
 * (see `infra/nango/providers/<provider>.md`).
 */
const ALLOWED_PROVIDERS = new Set(['google-calendar']);

export async function GET(request: NextRequest): Promise<Response> {
  const provider = request.nextUrl.searchParams.get('provider') ?? '';
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { error: `unsupported provider: ${provider || '<missing>'}` },
      { status: 400 },
    );
  }

  let env;
  try {
    env = authEnv();
  } catch (err) {
    return NextResponse.json(
      {
        error: 'auth env not configured',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  const cookies = await nextCookieAdapter();
  const user = await getUser(env, cookies);
  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const ctx = await getHouseholdContext();
  if (!ctx) {
    // A signed-in user with no household drifts to onboarding; from an
    // API-route perspective, we return 409 so the UI can decide.
    return NextResponse.json(
      { error: 'no household context; complete onboarding first' },
      { status: 409 },
    );
  }

  try {
    const nango = createWebNangoClient();
    const session = await nango.createConnectSession({
      endUser: {
        id: `member:${ctx.member.id}`,
        ...(user.email ? { email: user.email } : {}),
        tags: {
          household_id: ctx.household.id,
          member_id: ctx.member.id,
          provider,
        },
      },
      allowedIntegrations: [provider],
      tags: {
        household_id: ctx.household.id,
        member_id: ctx.member.id,
        provider,
      },
    });
    return NextResponse.redirect(session.connectLink, { status: 302 });
  } catch (err) {
    if (err instanceof NangoNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: 'failed to create Nango session',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
