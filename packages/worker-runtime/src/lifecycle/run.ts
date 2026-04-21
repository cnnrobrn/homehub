/**
 * Graceful-shutdown helpers.
 *
 * Workers run until Railway sends SIGTERM. On signal we:
 *   1. stop the main loop (handlers read the flag via `runWorker`),
 *   2. invoke every registered `onShutdown` callback in LIFO order so
 *      the thing registered last (usually the queue client) drains
 *      first and the first-registered (usually tracing/logs) flushes
 *      last,
 *   3. exit 0 if everything drained within the timeout; 1 otherwise.
 *
 * The spec (`specs/08-backend/workers.md`) calls for a 30s default
 * drain; longer-running workers override via the option.
 */

const shutdownHandlers: Array<() => Promise<void>> = [];
let shuttingDown = false;

/**
 * Registers a function to run on SIGTERM/SIGINT. Safe to call multiple
 * times; handlers run in reverse-registration order.
 */
export function onShutdown(fn: () => Promise<void>): void {
  shutdownHandlers.push(fn);
}

export interface RunWorkerOptions {
  /** Default 30s per spec. */
  shutdownTimeoutMs?: number;
}

/**
 * Calls `main` and installs SIGTERM/SIGINT handlers that drain
 * registered shutdown callbacks. Resolves when shutdown completes; the
 * caller is responsible for `process.exit(code)` in its entrypoint
 * (we return the exit code instead of calling `process.exit` so tests
 * can observe it without the process dying).
 */
export async function runWorker(
  main: () => Promise<void>,
  options: RunWorkerOptions = {},
): Promise<number> {
  const timeoutMs = options.shutdownTimeoutMs ?? 30_000;

  let exitCode = 0;
  const drain = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[worker-runtime] received ${signal}; draining`);

    const timer = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeoutMs).unref();
    });

    const drainPromise = (async () => {
      // Run in reverse order of registration.
      for (const fn of [...shutdownHandlers].reverse()) {
        try {
          await fn();
        } catch (err) {
          console.error('[worker-runtime] shutdown handler failed', err);
        }
      }
      return 'drained' as const;
    })();

    const result = await Promise.race([drainPromise, timer]);
    if (result === 'timeout') {
      exitCode = 1;
      console.error(`[worker-runtime] drain exceeded ${timeoutMs}ms; forcing exit with code 1`);
    }
  };

  process.on('SIGTERM', (sig) => void drain(sig));
  process.on('SIGINT', (sig) => void drain(sig));

  try {
    await main();
  } catch (err) {
    exitCode = 1;
    console.error('[worker-runtime] main() threw', err);
    await drain('SIGTERM');
  }

  // If main returned without a signal, still run the drain once so
  // registered flushers get a chance.
  if (!shuttingDown) {
    await drain('SIGTERM');
  }

  return exitCode;
}

/**
 * Test-only: clears registered handlers. Not exported publicly.
 * @internal
 */
export function __resetShutdownForTests(): void {
  shutdownHandlers.length = 0;
  shuttingDown = false;
}
