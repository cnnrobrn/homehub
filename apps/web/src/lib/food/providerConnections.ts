/**
 * Food provider connection readers.
 */

import { z } from 'zod';

import { hasFoodRead, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const getFoodProviderConnectionStatusArgsSchema = z.object({
  householdId: z.string().uuid(),
  provider: z.string().min(1),
});

export type GetFoodProviderConnectionStatusArgs = z.infer<
  typeof getFoodProviderConnectionStatusArgsSchema
>;

export interface FoodProviderConnectionStatus {
  provider: string;
  active: boolean;
  status: 'active' | 'paused' | 'errored' | 'revoked' | null;
  connectionId: string | null;
  lastSyncedAt: string | null;
}

interface Deps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function getFoodProviderConnectionStatus(
  args: GetFoodProviderConnectionStatusArgs,
  deps: Deps = {},
): Promise<FoodProviderConnectionStatus> {
  const parsed = getFoodProviderConnectionStatusArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) {
    return {
      provider: parsed.provider,
      active: false,
      status: null,
      connectionId: null,
      lastSyncedAt: null,
    };
  }

  const client = deps.client ?? (await createClient());
  const { data, error } = await client
    .schema('sync')
    .from('provider_connection')
    .select('id, provider, status, last_synced_at, created_at')
    .eq('household_id', parsed.householdId)
    .eq('provider', parsed.provider)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getFoodProviderConnectionStatus: ${error.message}`);

  if (!data) {
    return {
      provider: parsed.provider,
      active: false,
      status: null,
      connectionId: null,
      lastSyncedAt: null,
    };
  }

  const status = data.status as FoodProviderConnectionStatus['status'];
  return {
    provider: data.provider,
    active: status === 'active',
    status,
    connectionId: data.id,
    lastSyncedAt: data.last_synced_at ?? null,
  };
}
