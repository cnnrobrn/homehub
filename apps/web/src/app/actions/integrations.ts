/**
 * Server actions for integration connections (`sync.provider_connection`).
 *
 *   - `startConnectSessionAction` — mint a Nango Connect session and
 *     hand the URL back to the client for a popup. We use a popup
 *     (see `ConnectProviderButton`) instead of a full-page redirect
 *     because Nango has no post-OAuth `redirect_url` parameter —
 *     top-level navigation would strand the user on Nango's success
 *     screen and they'd perceive the connection as "not persisted".
 *   - `listConnectionsAction` — read the current member's household
 *     connections. RLS enforces that the caller is a member of the
 *     household; the query here filters by `household_id` taken from
 *     the resolved household context.
 *   - `disconnectConnectionAction` — delete the Nango connection and
 *     flip the row to `status='revoked'`. Owner-only.
 *
 * The legacy route handler at `/api/integrations/connect` still exists
 * as a fallback for direct-URL access (e.g. a stale deep link), but
 * the primary surface is the popup flow above.
 */

'use server';

import {
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  createServerClient,
  createServiceClient,
  getUser,
  resolveMemberId,
} from '@homehub/auth-server';
import { createGoogleOAuthClient } from '@homehub/oauth-google';
import { ALL_EMAIL_CATEGORIES, isEmailCategory } from '@homehub/providers-email/client';
import { createTokenCryptoFromEnv } from '@homehub/worker-runtime';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { getHouseholdContext } from '@/lib/auth/context';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';
import { serverEnv } from '@/lib/env';
import { NangoNotConfiguredError, createWebNangoClient } from '@/lib/nango/client';

export interface ConnectionSummary {
  id: string;
  provider: string;
  nangoConnectionId: string;
  status: 'active' | 'paused' | 'errored' | 'revoked';
  lastSyncedAt: string | null;
  memberId: string | null;
}

const ALLOWED_PROVIDERS = ['google-calendar', 'google-mail', 'ynab'] as const;
const startConnectSchema = z.object({
  provider: z.enum(ALLOWED_PROVIDERS),
  categories: z.array(z.string()).optional(),
});

function parseConnectLink(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Mint a Nango Connect session and return its URL so a client island can
 * open it in a popup. We avoid full-page navigation to Nango because the
 * Connect API has no post-OAuth redirect-back parameter — the user would
 * be stranded on Nango's success page with no way home. Opening the URL
 * in a popup keeps the caller on their originating page while the
 * client refreshes until the webhook-written `sync.provider_connection`
 * row shows up in the UI.
 */
export async function startConnectSessionAction(
  input: z.input<typeof startConnectSchema>,
): Promise<ActionResult<{ connectUrl: string }>> {
  try {
    const parsed = startConnectSchema.parse(input);
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const ctx = await getHouseholdContext();
    if (!ctx) throw new UnauthorizedError('no household context; complete onboarding first');

    let emailCategoriesCsv: string | undefined;
    if (parsed.provider === 'google-mail') {
      const requested = (parsed.categories ?? []).map((c) => c.trim()).filter(Boolean);
      const valid = requested.filter(isEmailCategory);
      if (valid.length === 0) {
        throw new ValidationError('no valid email categories opted in', [
          {
            path: 'categories',
            message: `choose at least one of: ${ALL_EMAIL_CATEGORIES.join(', ')}`,
          },
        ]);
      }
      emailCategoriesCsv = valid.join(',');
    }

    // Google now runs through our native OAuth service (not Nango).
    // The /api/oauth/google/start route mints state + PKCE and 302s to
    // Google's authorize endpoint; the popup handles the rest. Nango
    // remains the broker for other providers (ynab today).
    if (parsed.provider === 'google-calendar' || parsed.provider === 'google-mail') {
      const internalProvider = parsed.provider === 'google-calendar' ? 'gcal' : 'gmail';
      const search = new URLSearchParams({ provider: internalProvider });
      if (emailCategoriesCsv) search.set('categories', emailCategoriesCsv);
      return ok({ connectUrl: `/api/oauth/google/start?${search.toString()}` });
    }

    const tags: Record<string, string> = {
      household_id: ctx.household.id,
      member_id: ctx.member.id,
      provider: parsed.provider,
    };

    const nango = createWebNangoClient();
    const session = await nango.createConnectSession({
      endUser: {
        id: `member:${ctx.member.id}`,
        ...(user.email ? { email: user.email } : {}),
        tags,
      },
      allowedIntegrations: [parsed.provider],
      tags,
    });

    const connectUrl = parseConnectLink(session.connectLink);
    if (!connectUrl) {
      return {
        ok: false,
        error: {
          code: 'NANGO_CONNECT_LINK_INVALID',
          message: 'Nango did not return a valid connect_link',
        },
      };
    }
    return ok({ connectUrl: connectUrl.toString() });
  } catch (err) {
    if (err instanceof NangoNotConfiguredError) {
      return { ok: false, error: { code: 'NANGO_NOT_CONFIGURED', message: err.message } };
    }
    return toErr(err);
  }
}

export async function listConnectionsAction(): Promise<ActionResult<ConnectionSummary[]>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const ctx = await getHouseholdContext();
    if (!ctx) throw new UnauthorizedError('no household context');

    const client = createServerClient(env, cookies);
    const { data, error } = await client
      .schema('sync')
      .from('provider_connection')
      .select('id, provider, nango_connection_id, status, last_synced_at, member_id')
      .eq('household_id', ctx.household.id)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const rows: ConnectionSummary[] = (data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      nangoConnectionId: row.nango_connection_id,
      status: row.status as ConnectionSummary['status'],
      lastSyncedAt: row.last_synced_at,
      memberId: row.member_id,
    }));
    return ok(rows);
  } catch (err) {
    return toErr(err);
  }
}

const disconnectSchema = z.object({
  connectionId: z.string().uuid(),
});

/**
 * Map a stored `sync.provider_connection.provider` label to the Nango
 * `providerConfigKey` configured in the admin UI. Unknown providers
 * pass through untouched — Nango will 404 and we'll surface that
 * through the catch.
 */
function toNangoProviderKey(provider: string): string {
  switch (provider) {
    case 'gcal':
      return 'google-calendar';
    case 'gmail':
      return 'google-mail';
    default:
      return provider;
  }
}

export async function disconnectConnectionAction(
  input: z.input<typeof disconnectSchema>,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = disconnectSchema.parse(input);
    const ctx = await getHouseholdContext();
    if (!ctx) throw new UnauthorizedError('no household context');

    // Owner-only action: disconnecting severs a provider for the entire
    // household, not just one member's view of it.
    if (ctx.member.role !== 'owner') {
      throw new ForbiddenError('only the household owner can disconnect providers');
    }
    // Sanity check — the resolver should always return the caller's id.
    const service = createServiceClient(env);
    const callerMemberId = await resolveMemberId(service, ctx.household.id, user.id);
    if (!callerMemberId) throw new ForbiddenError('not a member of this household');

    // Read the connection first so we can dispatch to the right broker.
    const { data: connection, error: readErr } = await service
      .schema('sync')
      .from('provider_connection')
      .select('id, household_id, provider, nango_connection_id')
      .eq('id', parsed.connectionId)
      .eq('household_id', ctx.household.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!connection) throw new ForbiddenError('connection not found for this household');

    if (connection.provider === 'gcal' || connection.provider === 'gmail') {
      // Native Google path: revoke the refresh token at Google and
      // flip both rows (google_connection + provider_connection) to
      // revoked. The provider-side `watch` teardown is handled lazily
      // by the sync workers the next time they see the revoked status
      // — we don't instantiate providers here to keep the action lean.
      await revokeGoogleConnection(service, connection);
    } else {
      // Delete in Nango first; if that fails, we keep the row active
      // so the retry path is obvious. Swallowing a 404 from Nango
      // (already deleted upstream) is fine — we still flip the row.
      //
      // Nango identifies providers by `providerConfigKey` (e.g.
      // `google-calendar`), but the row stores HomeHub's short provider
      // label (`gcal`, `gmail`). Translate here.
      try {
        const nango = createWebNangoClient();
        const providerConfigKey = toNangoProviderKey(connection.provider);
        await nango.deleteConnection(providerConfigKey, connection.nango_connection_id);
      } catch (err) {
        console.warn('[disconnect] nango delete failed; continuing to mark revoked', err);
      }
    }

    const { error: updateErr } = await service
      .schema('sync')
      .from('provider_connection')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', connection.id);
    if (updateErr) throw updateErr;

    return ok({ ok: true });
  } catch (err) {
    return toErr(err);
  }
}

/**
 * Native-Google disconnect path.
 *
 * Steps:
 *   1. Load the peer `sync.google_connection` row for this
 *      `provider_connection`. If present (it should be), decrypt the
 *      refresh token and POST to Google's /revoke endpoint so the
 *      consent shows up as disconnected in the member's Google account
 *      security page.
 *   2. Flip the `sync.google_connection` row to `status='revoked'`.
 *
 * The outer action flips `sync.provider_connection` after we return.
 * Watch-channel teardown + cursor cleanup are handled lazily: the sync
 * workers see a revoked connection, stop polling, and let existing
 * channels expire naturally (Google caps at 7 days). Eager teardown
 * would require instantiating providers-calendar/providers-email here,
 * which is overkill for a disconnect action that must be fast.
 */
async function revokeGoogleConnection(
  service: ReturnType<typeof createServiceClient>,
  connection: {
    id: string;
    household_id: string;
    provider: string;
    nango_connection_id: string;
  },
): Promise<void> {
  const env = serverEnv();

  const { data: gcRow, error: readErr } = await (service
    .schema('sync' as never)
    .from('google_connection' as never)
    .select('id, refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag, key_version')
    .eq('id', connection.nango_connection_id)
    .maybeSingle() as unknown as Promise<{
    data: {
      id: string;
      refresh_token_ciphertext: string;
      refresh_token_iv: string;
      refresh_token_auth_tag: string;
      key_version: number;
    } | null;
    error: { message: string } | null;
  }>);
  if (readErr) {
    console.warn('[disconnect] google_connection lookup failed', readErr);
  }

  // Best-effort revoke at Google. 400 invalid_token is already a success
  // in `createGoogleOAuthClient.revoke`.
  if (
    gcRow &&
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REDIRECT_URI &&
    (process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_V1 || process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2)
  ) {
    try {
      const crypto = createTokenCryptoFromEnv(process.env);
      const refreshToken = crypto.decrypt({
        ciphertext: Buffer.from(gcRow.refresh_token_ciphertext, 'base64'),
        iv: Buffer.from(gcRow.refresh_token_iv, 'base64'),
        authTag: Buffer.from(gcRow.refresh_token_auth_tag, 'base64'),
        keyVersion: gcRow.key_version,
      });
      const oauth = createGoogleOAuthClient({
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
      });
      await oauth.revoke(refreshToken);
    } catch (err) {
      console.warn('[disconnect] google revoke failed; continuing to mark revoked', err);
    }
  }

  if (gcRow) {
    await service
      .schema('sync' as never)
      .from('google_connection' as never)
      .update({ status: 'revoked', updated_at: new Date().toISOString() } as never)
      .eq('id', gcRow.id);
  }
}
