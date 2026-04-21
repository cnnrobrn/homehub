/**
 * Server-side readers for `/ops/health`.
 *
 * Combines several data sources:
 *   - sync.worker_heartbeat   — per-service last-seen (table lands in
 *                               migration 0014+; until then the fetch
 *                               returns `{ heartbeats: [], pending: true }`).
 *   - pgmq metrics             — queue depth + age via `pgmq.metrics`
 *                                rpc (wrapped by the worker runtime's
 *                                QueueClient).
 *   - sync.provider_connection — active connections per provider.
 *   - audit.event              — last 20 actions for the household.
 *
 * Everything is scoped to the caller's household (audit, connections)
 * except queue metrics, which are global by nature. That's fine: only
 * owners can see this page, and the queue depth is operational data
 * rather than member data.
 */

import { createServiceClient } from '@homehub/auth-server';
import { createQueueClient, staticQueueNames } from '@homehub/worker-runtime';

import { authEnv } from '@/lib/auth/env';

export interface WorkerHeartbeat {
  service: string;
  component: string;
  lastSeenAt: string;
  stale: boolean;
}

export interface QueueMetric {
  queue: string;
  depth: number | null;
  ageSec: number | null;
  error: string | null;
}

export interface ProviderConnectionSummary {
  provider: string;
  active: number;
  paused: number;
  errored: number;
  revoked: number;
}

export interface AuditEventSummary {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  at: string;
}

export interface HealthReport {
  heartbeats: WorkerHeartbeat[];
  heartbeatTablePending: boolean;
  queues: QueueMetric[];
  connections: ProviderConnectionSummary[];
  recentAudit: AuditEventSummary[];
}

/** Threshold above which a heartbeat is marked stale. 10 min default. */
const STALE_HEARTBEAT_MS = 10 * 60 * 1000;

async function readHeartbeats(
  service: ReturnType<typeof createServiceClient>,
): Promise<{ heartbeats: WorkerHeartbeat[]; pending: boolean }> {
  // The `sync.worker_heartbeat` table lands in the pending migration
  // (see docs/ops/runbooks/worker-down.md). Until then the read errors
  // with PGRST204 or similar — we swallow and mark pending.
  try {
    const client = service as unknown as {
      schema: (name: string) => {
        from: (t: string) => {
          select: (c: string) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        };
      };
    };
    const { data, error } = await client
      .schema('sync')
      .from('worker_heartbeat')
      .select('service, component, last_seen_at')
      .order('last_seen_at', { ascending: false });
    if (error) {
      return { heartbeats: [], pending: true };
    }
    const rows = (data ?? []) as Array<{
      service: string;
      component: string;
      last_seen_at: string;
    }>;
    const now = Date.now();
    const heartbeats: WorkerHeartbeat[] = rows.map((r) => ({
      service: r.service,
      component: r.component,
      lastSeenAt: r.last_seen_at,
      stale: now - new Date(r.last_seen_at).getTime() > STALE_HEARTBEAT_MS,
    }));
    return { heartbeats, pending: false };
  } catch {
    return { heartbeats: [], pending: true };
  }
}

async function readQueues(service: ReturnType<typeof createServiceClient>): Promise<QueueMetric[]> {
  const queues = createQueueClient(service);
  const results = await Promise.all(
    staticQueueNames.map(async (name) => {
      try {
        const [depth, age] = await Promise.all([
          queues.depth(name).catch(() => null),
          queues.ageOfOldestSec(name).catch(() => null),
        ]);
        return { queue: name, depth, ageSec: age, error: null };
      } catch (err) {
        return {
          queue: name,
          depth: null,
          ageSec: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  return results;
}

async function readConnections(
  service: ReturnType<typeof createServiceClient>,
  householdId: string,
): Promise<ProviderConnectionSummary[]> {
  const { data, error } = await service
    .schema('sync')
    .from('provider_connection')
    .select('provider, status')
    .eq('household_id', householdId);
  if (error) {
    throw new Error(`provider_connection query failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ provider: string; status: string }>;
  const byProvider = new Map<string, ProviderConnectionSummary>();
  for (const r of rows) {
    const bucket = byProvider.get(r.provider) ?? {
      provider: r.provider,
      active: 0,
      paused: 0,
      errored: 0,
      revoked: 0,
    };
    switch (r.status) {
      case 'active':
        bucket.active += 1;
        break;
      case 'paused':
        bucket.paused += 1;
        break;
      case 'errored':
        bucket.errored += 1;
        break;
      case 'revoked':
        bucket.revoked += 1;
        break;
      default:
      // ignore unknown statuses; schema constrains but defensive
    }
    byProvider.set(r.provider, bucket);
  }
  return [...byProvider.values()].sort((a, z) => a.provider.localeCompare(z.provider));
}

async function readRecentAudit(
  service: ReturnType<typeof createServiceClient>,
  householdId: string,
): Promise<AuditEventSummary[]> {
  const { data, error } = await service
    .schema('audit')
    .from('event')
    .select('id, action, resource_type, resource_id, at')
    .eq('household_id', householdId)
    .order('at', { ascending: false })
    .limit(20);
  if (error) {
    throw new Error(`audit.event query failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    id: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    at: r.at,
  }));
}

export async function getHealthReport(householdId: string): Promise<HealthReport> {
  const env = authEnv();
  const service = createServiceClient(env);

  const [heartbeatResult, queues, connections, recentAudit] = await Promise.all([
    readHeartbeats(service),
    readQueues(service),
    readConnections(service, householdId),
    readRecentAudit(service, householdId),
  ]);

  return {
    heartbeats: heartbeatResult.heartbeats,
    heartbeatTablePending: heartbeatResult.pending,
    queues,
    connections,
    recentAudit,
  };
}
