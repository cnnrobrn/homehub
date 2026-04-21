/**
 * Remaining draft-write stubs.
 *
 * M9-C promoted `propose_transfer`, `propose_cancel_subscription`,
 * `draft_message`, `propose_add_to_calendar`, `propose_book_reservation`
 * and `settle_shared_expense` to real implementations that insert
 * `app.suggestion` rows (see sibling `proposeTransfer.ts` etc.). What
 * remains here are the memory-operation stubs — `supersede_fact` and
 * `forget_fact` — whose real implementations need
 * `@homehub/approval-flow`'s supersession path and will land alongside
 * M9-B's executor for the memory reconciler kind.
 *
 * Until then, the stubs produce a canonical `pending_approval`
 * envelope so the chat UI can render a suggestion card even before
 * the executor exists.
 */

import { z } from 'zod';

import type { ToolDefinition } from '../types.js';

const pendingResult = z.object({
  status: z.literal('pending_approval'),
  summary: z.string(),
  preview: z.record(z.string(), z.unknown()).nullable(),
});

type Pending = z.infer<typeof pendingResult>;

function stub<TIn>(
  name: string,
  description: string,
  input: z.ZodType<TIn>,
  segments: ToolDefinition<TIn, Pending>['segments'],
  summarize: (args: TIn) => string,
): ToolDefinition<TIn, Pending> {
  return {
    name,
    description,
    class: 'draft-write',
    input,
    output: pendingResult,
    segments,
    async handler(args) {
      return {
        status: 'pending_approval',
        summary: summarize(args),
        preview: args as Record<string, unknown>,
      };
    },
  };
}

export const supersedeFactStub = stub(
  'supersede_fact',
  'Propose an edit to an existing memory fact. Shows a before/after card; member confirms.',
  z.object({
    fact_id: z.string().uuid(),
    new_object_node_id: z.string().uuid().optional(),
    new_object_value: z.unknown().optional(),
    reason: z.string().optional(),
  }),
  'all',
  (a) => `Supersede fact ${a.fact_id}`,
);

export const forgetFactStub = stub(
  'forget_fact',
  'Propose deletion of a canonical memory fact. Member confirms on a diff card.',
  z.object({
    fact_id: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'all',
  (a) => `Forget fact ${a.fact_id}`,
);

export const draftWriteStubs = [supersedeFactStub, forgetFactStub] as const;
