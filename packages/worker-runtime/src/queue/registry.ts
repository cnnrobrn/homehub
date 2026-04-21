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
  /**
   * `embed_node` — fired after a `mem.node` is created or its
   * `document_md` is regenerated. Populates `mem.node.embedding` so
   * semantic retrieval works. Owned by @memory-background (M3.5-B).
   */
  embedNode: 'embed_node',
  reconcileTransaction: 'reconcile_transaction',
  pantryDiff: 'pantry_diff',
  generateSummary: 'generate_summary',
  evaluateAlerts: 'evaluate_alerts',
  generateSuggestions: 'generate_suggestions',
  executeAction: 'execute_action',
  /**
   * `evaluate_suggestion_approval` — fired once per `app.suggestion`
   * insert. The action-executor worker consumes this queue on a
   * sibling claim loop: it looks up the suggestion's kind, resolves
   * the effective policy (factoring in household settings and the
   * destructive-kind deny list), and either auto-approves + dispatches
   * or leaves the suggestion pending for a human tap. Owned by the
   * approval-flow package + the action-executor worker (M9-A).
   */
  evaluateSuggestionApproval: 'evaluate_suggestion_approval',
  /**
   * `household_export` — requests a portable export of a household's
   * data. Consumed by `@homehub/worker-backup-export` (M10). The
   * envelope carries the `sync.household_export.id` as `entity_id` so
   * the worker can update bookkeeping on the request row.
   */
  householdExport: 'household_export',

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
  queueNames.embedNode,
  queueNames.reconcileTransaction,
  queueNames.pantryDiff,
  queueNames.generateSummary,
  queueNames.evaluateAlerts,
  queueNames.generateSuggestions,
  queueNames.executeAction,
  queueNames.evaluateSuggestionApproval,
  queueNames.householdExport,
] as const;
