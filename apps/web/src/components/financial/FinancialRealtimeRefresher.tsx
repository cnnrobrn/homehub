/**
 * Realtime-refresher client island for the Financial segment.
 *
 * Subscribes to `postgres_changes` on `app.transaction`, `app.account`,
 * and `app.alert` — all filtered by `household_id`. Debounces bursts
 * (typical YNAB sync flushes dozens of upserts back-to-back) into one
 * `router.refresh()` call.
 *
 * Mount from `/financial`, `/financial/transactions`, `/financial/accounts`,
 * and `/financial/alerts`. The rest of the segment pages refresh on
 * navigation; adding more channels has marginal benefit and a real
 * connection cost per page.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

export interface FinancialRealtimeRefresherProps {
  householdId: string;
  debounceMs?: number;
}

const TABLES = ['transaction', 'account', 'alert'] as const;

export function FinancialRealtimeRefresher({
  householdId,
  debounceMs = 500,
}: FinancialRealtimeRefresherProps) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!householdId) return;
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        router.refresh();
        timeoutRef.current = null;
      }, debounceMs);
    };

    let channel = supabase.channel(`financial:${householdId}`);
    for (const table of TABLES) {
      channel = channel.on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'app',
          table,
          filter: `household_id=eq.${householdId}`,
        },
        () => scheduleRefresh(),
      );
    }
    channel.subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [householdId, debounceMs, router]);

  return null;
}
