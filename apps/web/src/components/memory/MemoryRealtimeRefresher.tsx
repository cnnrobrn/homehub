/**
 * Realtime refresher for memory graph pages.
 *
 * Subscribes to `postgres_changes` on `mem.fact` and `mem.node`
 * filtered by `household_id=eq.<id>`. Any INSERT/UPDATE/DELETE
 * triggers a debounced `router.refresh()` so the server-rendered
 * tree re-fetches. Mirrors the calendar realtime pattern exactly.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

export interface MemoryRealtimeRefresherProps {
  householdId: string;
  debounceMs?: number;
}

export function MemoryRealtimeRefresher({
  householdId,
  debounceMs = 500,
}: MemoryRealtimeRefresherProps) {
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

    const channel = supabase
      .channel(`mem:${householdId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'mem',
          table: 'fact',
          filter: `household_id=eq.${householdId}`,
        },
        scheduleRefresh,
      )
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'mem',
          table: 'node',
          filter: `household_id=eq.${householdId}`,
        },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [householdId, debounceMs, router]);

  return null;
}
