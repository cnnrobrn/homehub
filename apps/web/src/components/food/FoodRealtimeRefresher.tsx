/**
 * Realtime refresher for the food segment.
 *
 * Subscribes to `postgres_changes` on `app.meal`, `app.pantry_item`,
 * `app.grocery_list`, and `app.grocery_list_item` — all filtered by
 * `household_id`. Debounces bursts into a single `router.refresh()`.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

export interface FoodRealtimeRefresherProps {
  householdId: string;
  debounceMs?: number;
}

const TABLES = ['meal', 'pantry_item', 'grocery_list', 'grocery_list_item'] as const;

export function FoodRealtimeRefresher({
  householdId,
  debounceMs = 500,
}: FoodRealtimeRefresherProps) {
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

    let channel = supabase.channel(`food:${householdId}`);
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
