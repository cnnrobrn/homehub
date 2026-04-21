/**
 * Shared types for `@homehub/action-executors`.
 *
 * Every executor is constructed by a factory that receives the subset
 * of runtime deps it needs (calendar provider, email provider, etc.)
 * and returns an `ActionExecutor` that registers via
 * `registerExecutor(kind, handler)` into the action-executor worker's
 * registry.
 */

import { type ActionRow, type SuggestionRow } from '@homehub/approval-flow';
import { type CalendarProvider } from '@homehub/providers-calendar';
import { type EmailProvider } from '@homehub/providers-email';
import { type GroceryProvider } from '@homehub/providers-grocery';
import { type Logger, type ServiceSupabaseClient } from '@homehub/worker-runtime';

/**
 * Runtime deps exposed to every executor. Individual executors typically
 * only use a subset (the calendar executor wants `calendar`, the email
 * executor wants `email`, etc.); we pass the full bag into
 * `registerAllExecutors` and each factory picks what it needs. Keeps
 * wiring noise out of the worker's `main.ts`.
 */
export interface ExecutorDeps {
  supabase: ServiceSupabaseClient;
  calendar: CalendarProvider;
  email: EmailProvider;
  grocery: GroceryProvider;
  /**
   * Optional clock override for deterministic tests. Defaults to
   * `() => new Date()` inside each executor.
   */
  now?: () => Date;
}

/**
 * The executor handler signature — mirrors the shape the registry
 * expects. Kept local so action-executors package doesn't take a
 * compile-time dependency on the worker's `registry.ts`.
 */
export interface ExecutorInput {
  action: ActionRow;
  suggestion: SuggestionRow;
  supabase: ServiceSupabaseClient;
  log: Logger;
}

export interface ExecutorOutput {
  result: unknown;
}

export type ActionExecutor = (input: ExecutorInput) => Promise<ExecutorOutput>;
