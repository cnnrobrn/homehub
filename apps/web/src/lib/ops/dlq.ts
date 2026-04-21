/**
 * Server-side reader for `/ops/dlq`.
 *
 * Wraps `@homehub/dlq-admin`'s primitives with the web-app's Supabase
 * service client + cookie-aware auth env. RLS on `sync.dead_letter` is
 * service-role only (by migration 0009), so we bypass RLS here and
 * filter in Node. The owner-only gate lives in the `/ops` layout; the
 * server actions double-check the role before running mutations.
 */

import { createServiceClient } from '@homehub/auth-server';
import { listDeadLetters, type DlqEntry } from '@homehub/dlq-admin';

import { authEnv } from '@/lib/auth/env';

export type { DlqEntry };

export interface ListDlqForHouseholdArgs {
  householdId: string;
  queue?: string;
  limit?: number;
}

export async function listDlqForHousehold(args: ListDlqForHouseholdArgs): Promise<DlqEntry[]> {
  const env = authEnv();
  const service = createServiceClient(env);
  return listDeadLetters(service, {
    householdId: args.householdId,
    ...(args.queue ? { queue: args.queue } : {}),
    ...(args.limit ? { limit: args.limit } : {}),
  });
}
