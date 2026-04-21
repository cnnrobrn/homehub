/**
 * Realtime-refresher client island for the Fun segment.
 *
 * Subscribes to `postgres_changes` on `app.event`, `app.alert`, and
 * `app.suggestion` — all filtered by `household_id`. Debounces bursts
 * into one `router.refresh()` call.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

export interface FunRealtimeRefresherProps {
  householdId: string;
  debounceMs?: number;
}

const TABLES = ['event', 'alert', 'suggestion'] as const;

export function FunRealtimeRefresher({ householdId, debounceMs = 500 }: FunRealtimeRefresherProps) {
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

    let channel = supabase.channel(`fun:${householdId}`);
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
