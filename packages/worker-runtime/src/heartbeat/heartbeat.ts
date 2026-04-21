/**
 * Worker heartbeats.
 *
 * Every worker calls `recordWorkerHeartbeat()` once at startup (and
 * optionally on an interval) so the `/ops/health` dashboard can show
 * whether a service is alive.
 *
 * The landing table is `sync.worker_heartbeat(service, component,
 * last_seen_at, metadata)`, created by the pending migration 0014.
 * Until the migration lands, the upsert errors — we swallow and log
 * at debug so cold-start flows don't crash on pre-migration
 * environments.
 *
 * `startHeartbeatLoop()` bundles an initial write + an interval
 * timer. The interval is `unref()`-ed so it never keeps the Node
 * event loop alive on its own; a worker's main loop / HTTP server
 * is still the anchor.
 */

import { type Logger } from '../log/logger.js';
import { type ServiceSupabaseClient } from '../supabase/client.js';

export interface RecordHeartbeatArgs {
  supabase: ServiceSupabaseClient;
  service: string;
  component: string;
  metadata?: Record<string, unknown>;
  logger?: Logger;
}

/**
 * Upserts one row in `sync.worker_heartbeat`. Returns a boolean
 * indicating whether the write succeeded so callers can distinguish
 * "table missing" (pre-migration) from "all good".
 */
export async function recordWorkerHeartbeat(args: RecordHeartbeatArgs): Promise<boolean> {
  try {
    // The `worker_heartbeat` table is not part of the generated DB
    // types (it lands in a pending migration). Widen to `unknown` for
    // the upsert call; the schema columns + constraints live in SQL.
    const client = args.supabase as unknown as {
      schema: (name: string) => {
        from: (t: string) => {
          upsert: (
            value: Record<string, unknown>,
            opts: { onConflict: string },
          ) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error } = await client
      .schema('sync')
      .from('worker_heartbeat')
      .upsert(
        {
          service: args.service,
          component: args.component,
          last_seen_at: new Date().toISOString(),
          metadata: args.metadata ?? {},
        },
        { onConflict: 'service,component' },
      );
    if (error) {
      args.logger?.debug('heartbeat write failed', {
        service: args.service,
        component: args.component,
        error: error.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    args.logger?.debug('heartbeat write threw', {
      service: args.service,
      component: args.component,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export interface HeartbeatLoopHandle {
  stop(): void;
}

export interface StartHeartbeatLoopOptions extends RecordHeartbeatArgs {
  /** Interval in milliseconds. Defaults to 60s. */
  intervalMs?: number;
}

/**
 * Fires a heartbeat now, then repeats on the provided interval. Returns
 * a handle the caller can pass to `onShutdown()` so the loop drains
 * cleanly on SIGTERM.
 */
export function startHeartbeatLoop(options: StartHeartbeatLoopOptions): HeartbeatLoopHandle {
  const interval = options.intervalMs ?? 60_000;
  // Fire-and-forget the first beat; callers don't need to await it.
  void recordWorkerHeartbeat(options);
  const timer = setInterval(() => {
    void recordWorkerHeartbeat(options);
  }, interval);
  // Prevent the loop from keeping Node alive on its own.
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
