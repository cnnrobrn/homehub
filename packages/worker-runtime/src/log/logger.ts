/**
 * Structured JSON logger.
 *
 * Uses `pino` under the hood: fast, zero-alloc JSON output, battle-
 * tested, and has the child-logger API we want for propagating
 * `household_id` through a request chain.
 *
 * Every log line carries the fields required by
 * `specs/10-operations/observability.md`:
 *   - ts, level, service, component, msg
 * and accepts optional fields:
 *   - household_id, request_id, trace_id, span_id, duration_ms
 * plus any caller context (the second argument to `info()`, etc.).
 *
 * In development we wire `pino-pretty` for human-readable output. In
 * every other environment we emit one JSON object per line to stdout.
 */

import pino, { type Logger as PinoLogger } from 'pino';

import { type WorkerRuntimeEnv } from '../env.js';

export interface LogContext {
  household_id?: string;
  request_id?: string;
  trace_id?: string;
  span_id?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

export interface Logger {
  trace(msg: string, context?: LogContext): void;
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  fatal(msg: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

export interface LoggerOptions {
  service: string;
  component: string;
}

function wrap(inner: PinoLogger): Logger {
  return {
    trace: (msg, ctx) => inner.trace(ctx ?? {}, msg),
    debug: (msg, ctx) => inner.debug(ctx ?? {}, msg),
    info: (msg, ctx) => inner.info(ctx ?? {}, msg),
    warn: (msg, ctx) => inner.warn(ctx ?? {}, msg),
    error: (msg, ctx) => inner.error(ctx ?? {}, msg),
    fatal: (msg, ctx) => inner.fatal(ctx ?? {}, msg),
    child: (bindings) => wrap(inner.child(bindings)),
  };
}

export function createLogger(env: WorkerRuntimeEnv, options: LoggerOptions): Logger {
  const base: Record<string, unknown> = {
    service: options.service,
    component: options.component,
  };

  const transport =
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined;

  const inner = pino({
    level: env.LOG_LEVEL,
    base,
    // `timestamp` writes `ts` as an ISO-8601 string so every field the
    // observability spec requires is present with the canonical key.
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    // Pino emits `msg` by default; rename via `messageKey` only if a
    // log backend needs something else. The spec calls this `msg`, so
    // keep the default.
    messageKey: 'msg',
    ...(transport ? { transport } : {}),
  });

  return wrap(inner);
}
