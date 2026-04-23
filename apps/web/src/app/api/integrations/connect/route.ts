/**
 * GET /api/integrations/connect?provider=google-calendar
 * GET /api/integrations/connect?provider=google-mail&categories=receipt,shipping
 * GET /api/integrations/connect?provider=ynab
 *
 * Mints a Nango Connect session scoped to `(household_id, member_id,
 * provider)` and redirects the browser to Nango's hosted-auth URL.
 *
 * Flow:
 *   1. Verify the current user has a household context.
 *   2. For `google-mail`, validate that `categories` is a non-empty
 *      subset of the allowed set. The privacy-preview dialog in
 *      `/settings/connections` always sends the member-confirmed list,
 *      so a missing param means the caller hit the route directly; we
 *      404 in that case.
 *   3. For `ynab`, no per-category opt-in is required — financial data
 *      is all member-owned and goes through a single "read my YNAB"
 *      OAuth scope. A budget-picker UI is a follow-up for @frontend-chat
 *      (M5-C); today the sync worker picks the default / first budget.
 *   4. Call Nango `POST /connect/sessions` with:
 *        - `end_user.id` = `member:<member_id>` (stable HomeHub id).
 *        - `tags` = { household_id, member_id, provider, email_categories? }
 *          so the Nango webhook (handled by `apps/workers/webhook-ingest`)
 *          can route `connection.created` back to the right row and
 *          write any opt-in metadata into
 *          `sync.provider_connection.metadata`.
 *        - `allowed_integrations` = [provider]
 *   5. 302 to the `connect_link` returned by Nango.
 *
 * Error shape: anything that fails resolution returns a 4xx JSON body
 * rather than redirecting.
 */

import { UnauthorizedError, getUser } from '@homehub/auth-server';
import { ALL_EMAIL_CATEGORIES, isEmailCategory } from '@homehub/providers-email/client';
import { NextResponse, type NextRequest } from 'next/server';

import { getHouseholdContext } from '@/lib/auth/context';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';
import { NangoNotConfiguredError, createWebNangoClient } from '@/lib/nango/client';

export const dynamic = 'force-dynamic';

/**
 * Providers the connect route accepts. Each entry must correspond to a
 * Nango integration configured in the admin UI (see
 * `infra/nango/providers/<provider>.md`).
 */
const ALLOWED_PROVIDERS = new Set(['google-calendar', 'google-mail', 'ynab']);

export async function GET(request: NextRequest): Promise<Response> {
  const provider = request.nextUrl.searchParams.get('provider') ?? '';
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { error: `unsupported provider: ${provider || '<missing>'}` },
      { status: 400 },
    );
  }

  // Gmail-specific: require a confirmed category opt-in from the
  // privacy-preview dialog.
  let emailCategoriesCsv: string | undefined;
  if (provider === 'google-mail') {
    const raw = request.nextUrl.searchParams.get('categories');
    if (!raw) {
      return NextResponse.json(
        {
          error:
            'google-mail requires a `categories` opt-in list; use the Connect dialog in /settings/connections',
        },
        { status: 400 },
      );
    }
    const requested = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const valid = requested.filter(isEmailCategory);
    if (valid.length === 0) {
      return NextResponse.json(
        {
          error: 'no valid email categories opted in',
          allowed: ALL_EMAIL_CATEGORIES,
        },
        { status: 400 },
      );
    }
    emailCategoriesCsv = valid.join(',');
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
    return NextResponse.json(
      { error: 'no household context; complete onboarding first' },
      { status: 409 },
    );
  }

  const tags: Record<string, string> = {
    household_id: ctx.household.id,
    member_id: ctx.member.id,
    provider,
  };
  if (emailCategoriesCsv) {
    tags.email_categories = emailCategoriesCsv;
  }
  // Gmail needs the email address for later Pub/Sub routing. We pass the
  // authenticated user's email as a hint; the Nango webhook can override
  // it from the actual OAuth response if desired.
  if (provider === 'google-mail' && user.email) {
    tags.email_address = user.email;
  }

  try {
    const nango = createWebNangoClient();
    const session = await nango.createConnectSession({
      endUser: {
        id: `member:${ctx.member.id}`,
        ...(user.email ? { email: user.email } : {}),
        tags,
      },
      allowedIntegrations: [provider],
      tags,
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
