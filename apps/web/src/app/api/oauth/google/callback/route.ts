/**
 * GET /api/oauth/google/callback?code=...&state=...
 *
 * Final leg of the native Google OAuth flow. Receives the auth code
 * redirect back from Google, exchanges it for tokens, persists the
 * encrypted refresh/access token, upserts the user-visible
 * `sync.provider_connection` peer row, and runs the same post-connect
 * side effects the Nango webhook handler used to run (watch + label +
 * enqueue initial sync).
 *
 * Returns a minimal self-closing HTML page that posts a completion
 * message back to the opener window. The popup-opener UI
 * (`ConnectProviderButton`) also polls `listConnectionsAction`, so the
 * postMessage is belt-and-suspenders.
 */

import { createServiceClient } from '@homehub/auth-server';
import { createGoogleOAuthClient, GoogleOAuthError } from '@homehub/oauth-google';
import { createGoogleCalendarProvider } from '@homehub/providers-calendar';
import { HOMEHUB_INGESTED_LABEL_NAME, createGoogleMailProvider } from '@homehub/providers-email';
import {
  createGoogleHttpClient,
  createTokenCryptoFromEnv,
  runGcalPostConnect,
  runGmailPostConnect,
  createLogger,
} from '@homehub/worker-runtime';
import { type NextRequest } from 'next/server';

import { authEnv } from '@/lib/auth/env';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

interface OauthStateRow {
  state: string;
  code_verifier: string;
  household_id: string;
  member_id: string;
  provider: 'gcal' | 'gmail';
  requested_scopes: string[];
  email_categories: string[] | null;
  expires_at: string;
}

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    return htmlResponse(renderResultPage({ ok: false, error }));
  }
  if (!code || !state) {
    return htmlResponse(
      renderResultPage({ ok: false, error: 'missing code or state in callback' }),
      400,
    );
  }

  const env = serverEnv();
  if (
    !env.GOOGLE_OAUTH_CLIENT_ID ||
    !env.GOOGLE_OAUTH_CLIENT_SECRET ||
    !env.GOOGLE_OAUTH_REDIRECT_URI
  ) {
    return htmlResponse(
      renderResultPage({ ok: false, error: 'google oauth not configured on server' }),
      503,
    );
  }

  const log = createLogger({ SENTRY_DSN: undefined, LOG_LEVEL: 'info' } as never, {
    service: 'web',
    component: 'oauth-callback',
  });

  const service = createServiceClient(authEnv());

  // Consume the state row (single-use). We delete after validation
  // below so a failed exchange keeps it available for retry — actually
  // no: state is one-shot per RFC 6749; we delete as soon as we have
  // the row so a replayed callback is inert.
  const { data: stateData, error: stateErr } = await service
    .schema('sync' as never)
    .from('google_oauth_state' as never)
    .select(
      'state, code_verifier, household_id, member_id, provider, requested_scopes, email_categories, expires_at',
    )
    .eq('state', state)
    .maybeSingle();
  if (stateErr) {
    log.error('failed to load google_oauth_state', { error: stateErr.message });
    return htmlResponse(renderResultPage({ ok: false, error: 'oauth state lookup failed' }), 500);
  }
  if (!stateData) {
    return htmlResponse(renderResultPage({ ok: false, error: 'unknown state token' }), 400);
  }
  const stateRow = stateData as unknown as OauthStateRow;
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    await service
      .schema('sync' as never)
      .from('google_oauth_state' as never)
      .delete()
      .eq('state', state);
    return htmlResponse(
      renderResultPage({ ok: false, error: 'oauth state expired; please retry' }),
      400,
    );
  }
  await service
    .schema('sync' as never)
    .from('google_oauth_state' as never)
    .delete()
    .eq('state', state);

  const oauth = createGoogleOAuthClient({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });

  let tokenSet;
  try {
    tokenSet = await oauth.exchangeCode({ code, codeVerifier: stateRow.code_verifier });
  } catch (err) {
    const msg = err instanceof GoogleOAuthError ? `${err.code}: ${err.message}` : String(err);
    log.error('google code exchange failed', { error: msg });
    return htmlResponse(
      renderResultPage({ ok: false, error: `google code exchange failed (${msg})` }),
      502,
    );
  }
  if (!tokenSet.refreshToken || !tokenSet.idTokenPayload) {
    return htmlResponse(
      renderResultPage({
        ok: false,
        error:
          'google did not return a refresh token or id_token; disconnect+reconnect in Google account settings',
      }),
      502,
    );
  }
  const googleSub = tokenSet.idTokenPayload.sub;
  const email = tokenSet.idTokenPayload.email;

  if (!process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_V1 && !process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2) {
    return htmlResponse(
      renderResultPage({ ok: false, error: 'token encryption key not configured' }),
      503,
    );
  }
  const crypto = createTokenCryptoFromEnv(process.env);

  const refreshEnc = crypto.encrypt(tokenSet.refreshToken);
  const accessEnc = crypto.encrypt(tokenSet.accessToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + tokenSet.expiresIn * 1_000).toISOString();

  // Upsert sync.google_connection keyed on (household, provider, sub).
  // Returning the row so we can cascade to provider_connection.
  const { data: connRow, error: upsertErr } = await service
    .schema('sync' as never)
    .from('google_connection' as never)
    .upsert(
      {
        household_id: stateRow.household_id,
        member_id: stateRow.member_id,
        provider: stateRow.provider,
        google_sub: googleSub,
        email,
        scopes: stateRow.requested_scopes,
        refresh_token_ciphertext: refreshEnc.ciphertext.toString('base64'),
        refresh_token_iv: refreshEnc.iv.toString('base64'),
        refresh_token_auth_tag: refreshEnc.authTag.toString('base64'),
        access_token_ciphertext: accessEnc.ciphertext.toString('base64'),
        access_token_iv: accessEnc.iv.toString('base64'),
        access_token_auth_tag: accessEnc.authTag.toString('base64'),
        access_token_expires_at: expiresAt,
        key_version: refreshEnc.keyVersion,
        status: 'active',
        last_refreshed_at: now.toISOString(),
        updated_at: now.toISOString(),
      } as never,
      { onConflict: 'household_id,provider,google_sub' },
    )
    .select('id')
    .maybeSingle();
  if (upsertErr || !connRow) {
    log.error('google_connection upsert failed', {
      error: upsertErr?.message ?? 'no row returned',
    });
    return htmlResponse(
      renderResultPage({
        ok: false,
        error: `failed to persist google connection: ${upsertErr?.message ?? 'unknown'}`,
      }),
      500,
    );
  }
  const googleConnectionId = (connRow as { id: string }).id;

  // Upsert the user-visible peer row. `nango_connection_id` carries
  // our UUID for google rows — see `specs/03-integrations/google-oauth.md`.
  const metadata: Record<string, unknown> = {};
  if (stateRow.provider === 'gmail') {
    if (stateRow.email_categories && stateRow.email_categories.length > 0) {
      metadata.email_categories = stateRow.email_categories;
    }
    metadata.email_address = email;
  }
  const { data: pcRow, error: pcErr } = await service
    .schema('sync' as never)
    .from('provider_connection' as never)
    .upsert(
      {
        household_id: stateRow.household_id,
        member_id: stateRow.member_id,
        provider: stateRow.provider,
        nango_connection_id: googleConnectionId,
        status: 'active',
        updated_at: now.toISOString(),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      } as never,
      { onConflict: 'household_id,provider,nango_connection_id' },
    )
    .select('id, household_id')
    .maybeSingle();
  if (pcErr || !pcRow) {
    log.error('provider_connection upsert failed', {
      error: pcErr?.message ?? 'no row returned',
    });
    return htmlResponse(
      renderResultPage({
        ok: false,
        error: `failed to persist provider_connection: ${pcErr?.message ?? 'unknown'}`,
      }),
      500,
    );
  }
  const providerConnectionId = (pcRow as { id: string; household_id: string }).id;

  // Backfill the peer pointer on google_connection.
  await service
    .schema('sync' as never)
    .from('google_connection' as never)
    .update({ provider_connection_id: providerConnectionId } as never)
    .eq('id', googleConnectionId);

  // Post-connect side effects: watch + ensureLabel + enqueue initial sync.
  try {
    const http = createGoogleHttpClient({
      supabase: service as never,
      oauth,
      crypto,
      log,
    });
    if (stateRow.provider === 'gcal') {
      const calendar = createGoogleCalendarProvider({ nango: http });
      // `QueueClient` isn't wired from the web app today — the
      // `runGcalPostConnect` helper enqueues sync_full:* which requires
      // a queue client. Rather than instantiating the full pgmq client
      // here (which would need the private `supabase.schema('pgmq')`
      // bindings), we enqueue inline via RPC.
      const webhookUrl = process.env.WEBHOOK_PUBLIC_URL;
      await runGcalPostConnect(
        {
          supabase: service as never,
          queues: makeInlineQueueClient(service),
          calendar,
          log,
          env: {
            ...(webhookUrl ? { WEBHOOK_PUBLIC_URL: webhookUrl } : {}),
          },
        },
        {
          connectionId: googleConnectionId,
          providerConnectionId,
          householdId: stateRow.household_id,
        },
      );
    } else {
      const emailProv = createGoogleMailProvider({ nango: http });
      const pubsubTopic = process.env.NANGO_GMAIL_PUBSUB_TOPIC;
      await runGmailPostConnect(
        {
          supabase: service as never,
          queues: makeInlineQueueClient(service),
          email: emailProv,
          log,
          env: {
            ...(pubsubTopic ? { NANGO_GMAIL_PUBSUB_TOPIC: pubsubTopic } : {}),
          },
        },
        {
          connectionId: googleConnectionId,
          providerConnectionId,
          householdId: stateRow.household_id,
          labelName: HOMEHUB_INGESTED_LABEL_NAME,
          emailAddress: email,
        },
      );
    }
  } catch (err) {
    // Non-fatal — the connection is written and the sync workers will
    // retry. Log and move on so the user sees success.
    log.error('post-connect setup failed (non-fatal)', {
      connection_id: googleConnectionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return htmlResponse(renderResultPage({ ok: true }));
}

/**
 * Inline `QueueClient` shim that only implements `send` (the single
 * method `runGcalPostConnect` / `runGmailPostConnect` actually use)
 * against the pgmq `pgmq_public.send` RPC. Full `QueueClient` wiring
 * lives in worker-runtime; we don't want the web bundle to take a
 * transitive dep on every `pgmq_*` RPC.
 */
function makeInlineQueueClient(service: ReturnType<typeof createServiceClient>) {
  return {
    async send(queue: string, envelope: unknown) {
      const { error } = await (
        service.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>
      )('pgmq_public_send', {
        queue_name: queue,
        msg: envelope,
      });
      if (error) {
        // Fall back to the underlying pgmq RPC name if the public alias
        // isn't present in this environment.
        const { error: fallbackErr } = await (
          service.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ error: { message: string } | null }>
        )('send', {
          queue_name: queue,
          msg: envelope,
        });
        if (fallbackErr) {
          throw new Error(`queue send failed: ${error.message} (fallback: ${fallbackErr.message})`);
        }
      }
    },
  } as never;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function renderResultPage(result: { ok: true } | { ok: false; error: string }): string {
  const payload = JSON.stringify(result);
  return `<!doctype html><html><head><meta charset="utf-8"><title>HomeHub — Connection</title><style>body{font-family:system-ui,sans-serif;padding:2rem;text-align:center;color:#111}</style></head><body><h1>${result.ok ? 'Connected!' : 'Connection failed'}</h1>${result.ok ? '<p>You can close this window.</p>' : `<p>${escapeHtml((result as { error: string }).error)}</p>`}<script>try{window.opener&&window.opener.postMessage(${payload},'*');}catch(_){}setTimeout(function(){try{window.close();}catch(_){}},${result.ok ? 600 : 3000});</script></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
