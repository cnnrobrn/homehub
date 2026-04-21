/**
 * Server actions for integration connections (`sync.provider_connection`).
 *
 *   - `listConnectionsAction` — read the current member's household
 *     connections. RLS enforces that the caller is a member of the
 *     household; the query here filters by `household_id` taken from
 *     the resolved household context.
 *   - `disconnectConnectionAction` — delete the Nango connection and
 *     flip the row to `status='revoked'`. Owner-only.
 *
 * The "connect" flow isn't a server action — it's a route handler at
 * `/api/integrations/connect` so the browser can be redirected to the
 * hosted-auth URL with a 302. See `app/api/integrations/connect/route.ts`.
 */

'use server';

import {
  UnauthorizedError,
  ForbiddenError,
  createServerClient,
  createServiceClient,
  getUser,
  resolveMemberId,
} from '@homehub/auth-server';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { getHouseholdContext } from '@/lib/auth/context';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';
import { createWebNangoClient } from '@/lib/nango/client';

export interface ConnectionSummary {
  id: string;
  provider: string;
  nangoConnectionId: string;
  status: 'active' | 'paused' | 'errored' | 'revoked';
  lastSyncedAt: string | null;
  memberId: string | null;
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

    // Read the connection first so we can call Nango with the right id.
    const { data: connection, error: readErr } = await service
      .schema('sync')
      .from('provider_connection')
      .select('id, household_id, provider, nango_connection_id')
      .eq('id', parsed.connectionId)
      .eq('household_id', ctx.household.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!connection) throw new ForbiddenError('connection not found for this household');

    // Delete in Nango first; if that fails, we keep the row active so
    // the retry path is obvious. Swallowing a 404 from Nango (already
    // deleted upstream) is fine — we still flip the row.
    try {
      const nango = createWebNangoClient();
      await nango.deleteConnection(connection.provider, connection.nango_connection_id);
    } catch (err) {
      // Log via console because server actions have no logger injected
      // and the operator will see this in Vercel logs.

      console.warn('[disconnect] nango delete failed; continuing to mark revoked', err);
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
