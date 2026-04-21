/**
 * Single source of truth for pgmq queue names.
 *
 * String literals for queue names are easy to typo and hard to refactor,
 * so every worker and producer imports `queueNames` from here. Templated
 * queues (e.g. `sync_full:gcal`) are produced by builder functions; the
 * `allStaticNames` array exists so bootstrap code (migrations that
 * `pgmq.create` each queue) can iterate.
 *
 * Spec: `specs/08-backend/queues.md` is the source of truth for the set.
 */

export const queueNames = {
  enrichEvent: 'enrich_event',
  enrichEmail: 'enrich_email',
  enrichTransaction: 'enrich_transaction',
  enrichMeal: 'enrich_meal',
  /**
   * `enrich_conversation` — fired once per **member** turn in a chat
   * conversation. The member's message is a likely source of teachable
   * facts; the enrichment worker routes those through the normal
   * candidate pipeline. Handler lives with @memory-background (M3.5-B).
   */
  enrichConversation: 'enrich_conversation',
  /**
   * `rollup_conversation` — fired after a substantive assistant turn
   * to enqueue the conversation→episode rollup job. Also owned by
   * @memory-background (M3.5-B).
   */
  rollupConversation: 'rollup_conversation',
  nodeRegen: 'node_regen',
  reconcileTransaction: 'reconcile_transaction',
  pantryDiff: 'pantry_diff',
  generateSummary: 'generate_summary',
  evaluateAlerts: 'evaluate_alerts',
  generateSuggestions: 'generate_suggestions',
  executeAction: 'execute_action',

  /**
   * `sync_full:{provider}` — one queue per provider. Built from the
   * provider key (e.g. `'gcal'`, `'gmail'`, `'monarch'`) so scaling
   * knobs and DLQ views can be provider-scoped.
   */
  syncFull: (provider: string): string => `sync_full:${provider}`,
  /**
   * `sync_delta:{provider}` — same idea as syncFull but for incremental
   * pulls.
   */
  syncDelta: (provider: string): string => `sync_delta:${provider}`,
  /**
   * `backfill:{target}` — ad-hoc reprocessing queue, one per backfill
   * target (e.g. `'enrich_event_v2'`).
   */
  backfill: (target: string): string => `backfill:${target}`,
} as const;

/**
 * The non-templated queue names, suitable for iterating in bootstrap
 * code. The templated ones (`sync_full:*`, `sync_delta:*`, `backfill:*`)
 * are materialized lazily when a new provider/target first appears.
 */
export const staticQueueNames: readonly string[] = [
  queueNames.enrichEvent,
  queueNames.enrichEmail,
  queueNames.enrichTransaction,
  queueNames.enrichMeal,
  queueNames.enrichConversation,
  queueNames.rollupConversation,
  queueNames.nodeRegen,
  queueNames.reconcileTransaction,
  queueNames.pantryDiff,
  queueNames.generateSummary,
  queueNames.evaluateAlerts,
  queueNames.generateSuggestions,
  queueNames.executeAction,
] as const;
