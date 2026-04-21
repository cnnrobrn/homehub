/**
 * Executor for the `propose_grocery_order` action kind.
 *
 * Calls `GroceryProvider.createDraftOrder`. The current provider wired
 * in production is the stub (Instacart API access is human-gated); it
 * returns a sentinel draft URL that the UI branches on to render a
 * "copy this list" export instead of a deep link. The executor does
 * not distinguish — both return a `{ draft_id, url }` pair.
 *
 * See `specs/13-conversation/tools.md` § propose_grocery_order and
 * `packages/providers/grocery/src/stub.ts` for the sentinel URL.
 */

import { type GroceryProvider } from '@homehub/providers-grocery';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

const itemSchema = z.object({
  sku: z.string().optional(),
  name: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  price_per_unit_cents: z.number().optional(),
});

export const proposeGroceryOrderPayloadSchema = z.object({
  items: z.array(itemSchema).min(1, 'at least one item required'),
  delivery_window: z
    .object({
      start: z.string(),
      end: z.string(),
    })
    .optional(),
  provider: z.string().optional(),
});

export type ProposeGroceryOrderPayload = z.infer<typeof proposeGroceryOrderPayloadSchema>;

export interface CreateProposeGroceryOrderExecutorArgs {
  grocery: GroceryProvider;
  supabase: ExecutorDeps['supabase'];
  /**
   * Provider label stored on `sync.provider_connection.provider`. For v1
   * we target the stub/instacart connection; the Supabase lookup gives
   * us a graceful fallback when no real connection exists (the stub
   * provider succeeds without one).
   */
  providerLabel?: string;
}

export function createProposeGroceryOrderExecutor(
  deps: CreateProposeGroceryOrderExecutorArgs,
): ActionExecutor {
  const providerLabel = deps.providerLabel ?? 'instacart';

  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: ProposeGroceryOrderPayload;
    try {
      payload = proposeGroceryOrderPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    // The stub provider doesn't need a connection, but the real
    // Instacart adapter does. Look one up and pass its id; when absent
    // we pass a sentinel so the stub can still draft. If the adapter
    // insists on a real connection it will throw and we'll DLQ.
    const conn = await resolveConnection(deps.supabase, {
      householdId: action.household_id,
      provider: providerLabel,
    });

    const connectionId = conn?.connectionId ?? `stub-${action.household_id}`;

    log.info('creating grocery draft order', {
      connection_row_id: conn?.connectionRowId ?? null,
      item_count: payload.items.length,
      provider_label: providerLabel,
    });

    try {
      const created = await deps.grocery.createDraftOrder({
        connectionId,
        items: payload.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          ...(i.sku ? { sku: i.sku } : {}),
          ...(i.unit ? { unit: i.unit } : {}),
          ...(i.price_per_unit_cents !== undefined
            ? { pricePerUnitCents: i.price_per_unit_cents }
            : {}),
        })),
        metadata: payload.delivery_window ? { delivery_window: payload.delivery_window } : {},
      });
      return {
        result: {
          draft_id: created.draftId,
          url: created.url,
          connection_id: conn?.connectionRowId ?? null,
        },
      };
    } catch (err) {
      if (err instanceof PermanentExecutorError) throw err;
      throwAsExecutorError(err, 'grocery_draft_write_failed');
    }
  };
}
