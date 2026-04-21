/**
 * Sentry bootstrap for workers.
 *
 * Sentry is an *optional* dependency — we never import `@sentry/node`
 * at module-scope because it drags a large transitive graph into every
 * worker's cold start. `initSentry()` performs a dynamic import only
 * when `SENTRY_DSN` is set in the environment.
 *
 * When the DSN is unset, this function is a no-op and logs a single
 * info line so staging deploys can tell the difference between
 * "misconfigured" and "intentionally disabled".
 *
 * The optional dependency is resolved at runtime; we do not list
 * `@sentry/node` in `package.json` dependencies because it's only
 * required in production deployments (Railway sets the DSN in prod).
 * A missing package in dev surfaces a friendly warning rather than a
 * startup crash.
 */

import { type WorkerRuntimeEnv } from '../env.js';
import { type Logger } from '../log/logger.js';

export interface SentryHandle {
  /** Flushes pending events and shuts Sentry down. Idempotent. */
  shutdown(): Promise<void>;
}

const NOOP_HANDLE: SentryHandle = {
  async shutdown() {
    /* no-op */
  },
};

export interface InitSentryOptions {
  service: string;
  release?: string;
  tracesSampleRate?: number;
  logger?: Logger;
}

export async function initSentry(
  env: WorkerRuntimeEnv,
  options: InitSentryOptions,
): Promise<SentryHandle> {
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    options.logger?.info('sentry disabled (SENTRY_DSN unset)', { service: options.service });
    return NOOP_HANDLE;
  }

  // Dynamic import so environments without `@sentry/node` installed
  // still boot. Workers that want Sentry add the package as an optional
  // peer — we reference it through `unknown` so missing types don't
  // fail the typecheck.
  interface SentryLike {
    init(opts: Record<string, unknown>): void;
    close(timeoutMs?: number): Promise<boolean>;
  }
  let sentry: SentryLike | null = null;
  try {
    // Indirect module specifier: TypeScript cannot resolve `name` at
    // compile time, so the optional package doesn't need types during
    // typecheck. At runtime Node resolves the module normally.
    const name = '@sentry/node';
    const mod: unknown = await (
      new Function('m', 'return import(m)') as (m: string) => Promise<unknown>
    )(name).catch(() => null);
    if (mod && typeof mod === 'object' && 'init' in mod && 'close' in mod) {
      sentry = mod as SentryLike;
    }
  } catch (err) {
    options.logger?.warn(
      'sentry init skipped: @sentry/node not installed; add as an optional dep',
      {
        service: options.service,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return NOOP_HANDLE;
  }

  if (!sentry) {
    options.logger?.warn(
      'sentry init skipped: @sentry/node not installed; add as an optional dep',
      { service: options.service },
    );
    return NOOP_HANDLE;
  }

  sentry.init({
    dsn,
    environment: env.NODE_ENV,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate ?? 0,
    serverName: options.service,
  });

  options.logger?.info('sentry initialized', { service: options.service });

  return {
    async shutdown() {
      try {
        await sentry?.close(2_000);
      } catch {
        // Best-effort flush; do not throw on shutdown.
      }
    },
  };
}
