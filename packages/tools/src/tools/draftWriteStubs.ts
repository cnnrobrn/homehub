/**
 * Draft-write stubs.
 *
 * Per the M3.5-A dispatch: real draft-write execution lands in M9
 * (approval flow). For now, these stubs live in the catalog so the
 * model sees a realistic action surface and the chat UI can render
 * suggestion cards. Each stub accepts its documented args, performs
 * no DB writes, and returns a canonical `pending_approval` payload.
 *
 * When M9 wires the approval flow, these stubs flip to real handlers
 * that `INSERT INTO app.suggestion`. Until then, the agent loop
 * intercepts the stub result and emits a suggestion card event in
 * the stream.
 *
 * M6 promoted the food-segment stubs (`add_meal_to_plan`,
 * `draft_meal_plan`, `propose_grocery_order`) to real implementations
 * under `./food/*`. The remaining stubs here cover financial, social,
 * fun, and memory operations whose approval flow still lands in M9.
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

export const proposeTransferStub = stub(
  'propose_transfer',
  'Propose a transfer between accounts. Creates a suggestion; member approves.',
  z.object({
    from_account: z.string().uuid(),
    to_account: z.string().uuid(),
    amount_cents: z.number().int().positive(),
    reason: z.string().min(1).max(200),
  }),
  ['financial'],
  (a) => `Transfer $${(a.amount_cents / 100).toFixed(2)}: ${a.reason}`,
);

export const draftMessageStub = stub(
  'draft_message',
  'Create a Gmail draft to the recipient. Sent only after member review.',
  z.object({
    recipient_person: z.string().min(1),
    subject: z.string().optional(),
    body: z.string().min(1),
  }),
  ['social'],
  (a) => `Draft message to ${a.recipient_person}`,
);

export const proposeAddToCalendarStub = stub(
  'propose_add_to_calendar',
  'Propose a calendar event. Creates a suggestion; member approves.',
  z.object({
    title: z.string().min(1),
    start: z.string(),
    end: z.string().optional(),
    attendees: z.array(z.string()).optional(),
    mirror_to_gcal: z.boolean().optional(),
  }),
  ['fun'],
  (a) => `Propose "${a.title}" starting ${a.start}`,
);

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

export const draftWriteStubs = [
  proposeTransferStub,
  draftMessageStub,
  proposeAddToCalendarStub,
  supersedeFactStub,
  forgetFactStub,
] as const;
