/**
 * Enrichment pipeline.
 *
 * Composes the model-backed classifier + extractor with the
 * deterministic fallback classifier, and routes each step according
 * to the household's budget tier:
 *
 *   - `default` budget: model classifier + model extractor.
 *   - `degraded` budget: model classifier + model extractor, but the
 *     caller may choose to drop extraction to skip high-cost jobs.
 *     The pipeline exposes `allowExtraction` as an explicit arg.
 *   - `budget_exceeded`: deterministic classifier only. No model
 *     calls. Extraction is skipped entirely.
 *
 * Any model failure at either step falls back to the deterministic
 * classifier (for classification) or returns an empty extraction (for
 * extraction). Extraction failures are non-fatal per
 * `specs/04-memory-network/extraction.md` — the event still gets a
 * segment.
 *
 * Spec: `specs/04-memory-network/enrichment-pipeline.md` +
 * `specs/05-agents/model-routing.md` (budget tiers).
 */

import { type HouseholdId } from '@homehub/shared';
import {
  withBudgetGuard,
  type BudgetCheckResult,
  type Logger,
  type ServiceSupabaseClient,
} from '@homehub/worker-runtime';

import { type ModelEventClassifier } from './model-classifier.js';
import {
  type ExtractionResult,
  type HouseholdContext,
  type ModelEventExtractor,
} from './model-extractor.js';
import { type EventClassification, type EventClassifier, type EventInput } from './types.js';

export interface EnrichmentPipelineDeps {
  modelClassifier: ModelEventClassifier;
  modelExtractor: ModelEventExtractor;
  deterministicClassifier: EventClassifier;
  supabase: ServiceSupabaseClient;
  log: Logger;
}

export interface ClassifyArgs {
  event: EventInput;
  householdId: HouseholdId;
  householdContext?: string;
  /** Pre-computed by the worker if it already checked the budget. */
  budget?: BudgetCheckResult;
}

export interface ExtractArgs {
  event: EventInput;
  context: HouseholdContext;
  existingEnrichment?: unknown;
  /** Pre-computed by the worker if it already checked the budget. */
  budget?: BudgetCheckResult;
  /**
   * When true, extraction runs even on the degraded tier. Workers
   * drop extraction under `degraded` by default; callers who
   * specifically want the extraction pass set this to true.
   */
  allowExtraction?: boolean;
}

export interface ClassifyOutcome {
  classification: EventClassification;
  source: 'model' | 'deterministic';
  budget: BudgetCheckResult;
}

export interface ExtractOutcome {
  extraction: ExtractionResult;
  ran: boolean;
  reason: 'ok' | 'budget_exceeded' | 'degraded_skipped' | 'model_error';
  budget: BudgetCheckResult;
}

export interface EnrichmentPipeline {
  classify(args: ClassifyArgs): Promise<ClassifyOutcome>;
  extract(args: ExtractArgs): Promise<ExtractOutcome>;
}

async function resolveBudget(
  supabase: ServiceSupabaseClient,
  householdId: HouseholdId,
  supplied: BudgetCheckResult | undefined,
  taskClass: string,
  log: Logger,
): Promise<BudgetCheckResult> {
  if (supplied) return supplied;
  return withBudgetGuard(supabase, { household_id: householdId, task_class: taskClass }, log);
}

export function createEnrichmentPipeline(deps: EnrichmentPipelineDeps): EnrichmentPipeline {
  const { modelClassifier, modelExtractor, deterministicClassifier, supabase, log } = deps;

  return {
    async classify({ event, householdId, householdContext, budget }) {
      const resolvedBudget = await resolveBudget(
        supabase,
        householdId,
        budget,
        'enrichment.event.classify',
        log,
      );

      if (!resolvedBudget.ok) {
        log.info('classify: budget exceeded, using deterministic classifier', {
          household_id: householdId,
        });
        return {
          classification: deterministicClassifier.classify(event),
          source: 'deterministic',
          budget: resolvedBudget,
        };
      }

      try {
        const classification = await modelClassifier.classify({
          event,
          householdId,
          ...(householdContext !== undefined ? { householdContext } : {}),
        });
        return { classification, source: 'model', budget: resolvedBudget };
      } catch (err) {
        log.warn('classify: model classifier failed; falling back to deterministic', {
          household_id: householdId,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          classification: deterministicClassifier.classify(event),
          source: 'deterministic',
          budget: resolvedBudget,
        };
      }
    },

    async extract({ event, context, existingEnrichment, budget, allowExtraction }) {
      const resolvedBudget = await resolveBudget(
        supabase,
        context.householdId,
        budget,
        'enrichment.event',
        log,
      );

      if (!resolvedBudget.ok) {
        log.info('extract: budget exceeded; skipping fact extraction', {
          household_id: context.householdId,
        });
        return {
          extraction: { episodes: [], facts: [] },
          ran: false,
          reason: 'budget_exceeded',
          budget: resolvedBudget,
        };
      }

      if (resolvedBudget.tier === 'degraded' && allowExtraction !== true) {
        log.info('extract: degraded tier; skipping fact extraction', {
          household_id: context.householdId,
        });
        return {
          extraction: { episodes: [], facts: [] },
          ran: false,
          reason: 'degraded_skipped',
          budget: resolvedBudget,
        };
      }

      try {
        const extraction = await modelExtractor.extract({
          event,
          context,
          ...(existingEnrichment !== undefined ? { existingEnrichment } : {}),
        });
        return { extraction, ran: true, reason: 'ok', budget: resolvedBudget };
      } catch (err) {
        log.warn('extract: model extractor failed; yielding empty extraction', {
          household_id: context.householdId,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          extraction: { episodes: [], facts: [] },
          ran: false,
          reason: 'model_error',
          budget: resolvedBudget,
        };
      }
    },
  };
}
