/**
 * Connection resolver — picks the best `sync.provider_connection` for a
 * given household + provider.
 *
 * HomeHub stores one row per (member, provider) connection (per the M1
 * migration and `specs/03-integrations/google-workspace.md` §
 * Connection model). An executor needs exactly one connection to call
 * through. The resolution rule, matching the briefing:
 *
 *   1. Prefer the owner-member's active connection.
 *   2. Fall back to any other adult member's active connection.
 *   3. Return `null` when no active connection exists for this household.
 *
 * The returned `connectionId` is the Nango-side connection id
 * (`sync.provider_connection.nango_connection_id`), NOT the HomeHub
 * row id — that's the value every provider adapter expects in its
 * `{ connectionId }` argument.
 *
 * Revoked and pending connections are excluded. Executors that find no
 * connection should raise a `PermanentExecutorError('no_<provider>_connection')`
 * so the worker DLQs with a clear signal to the UI.
 *
 * Implementation notes: `sync.provider_connection.member_id` references
 * `app.member.id` but PostgREST's cross-schema joins are fragile, so we
 * split the read into two queries — connections first, then members —
 * and rank the roles client-side. This keeps the code portable across
 * Supabase versions.
 */

import { type ServiceSupabaseClient } from '@homehub/worker-runtime';

export interface ResolveConnectionArgs {
  householdId: string;
  /**
   * HomeHub-internal provider label (matches `sync.provider_connection.provider`).
   * Common values: `'gcal'`, `'gmail'`, `'ynab'`, `'instacart'`.
   */
  provider: string;
}

export interface ResolvedConnection {
  /** Nango connection id (stable identifier passed to provider adapters). */
  connectionId: string;
  /** HomeHub member id that owns this connection. */
  memberId: string | null;
  /** The `sync.provider_connection.id` row id, for audit trails. */
  connectionRowId: string;
}

interface ConnectionRow {
  id: string;
  member_id: string | null;
  nango_connection_id: string;
  status: string;
}

interface MemberRow {
  id: string;
  role: string | null;
}

/**
 * Rank member roles for connection preference.
 *   0 = owner       (highest preference)
 *   1 = adult
 *   2 = other / unknown
 */
function rankRole(role: string | null | undefined): number {
  if (role === 'owner') return 0;
  if (role === 'adult') return 1;
  return 2;
}

/**
 * Resolve the Nango connection HomeHub should use for this household +
 * provider. Returns `null` when no active connection is available.
 *
 * Preference order:
 *   - `member.role = 'owner'` with `status = 'active'`.
 *   - `member.role = 'adult'` with `status = 'active'`.
 *   - Any other active connection (last resort; children shouldn't
 *     connect providers but we don't hard-error on it).
 */
export async function resolveConnection(
  supabase: ServiceSupabaseClient,
  args: ResolveConnectionArgs,
): Promise<ResolvedConnection | null> {
  const { data: connectionData, error: connectionErr } = await supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, member_id, nango_connection_id, status')
    .eq('household_id', args.householdId)
    .eq('provider', args.provider)
    .eq('status', 'active');

  if (connectionErr) {
    // Surface to the caller; Supabase errors are transient and the
    // worker should retry.
    throw new Error(`provider_connection lookup failed: ${connectionErr.message}`);
  }

  const connections = (connectionData ?? []) as ConnectionRow[];
  if (connections.length === 0) return null;

  // Resolve member roles for the subset of connections that name one.
  const memberIds = Array.from(
    new Set(connections.map((c) => c.member_id).filter((id): id is string => Boolean(id))),
  );

  const roleByMember = new Map<string, string | null>();
  if (memberIds.length > 0) {
    const { data: memberData, error: memberErr } = await supabase
      .schema('app')
      .from('member')
      .select('id, role')
      .in('id', memberIds);
    if (memberErr) {
      throw new Error(`app.member lookup failed: ${memberErr.message}`);
    }
    for (const m of (memberData ?? []) as MemberRow[]) {
      roleByMember.set(m.id, m.role);
    }
  }

  const scored = connections.map((row) => {
    const role = row.member_id ? (roleByMember.get(row.member_id) ?? null) : null;
    return { row, rank: rankRole(role) };
  });
  scored.sort((a, b) => a.rank - b.rank);
  const best = scored[0]!.row;

  return {
    connectionId: best.nango_connection_id,
    memberId: best.member_id,
    connectionRowId: best.id,
  };
}
