/**
 * Intent prefilter.
 *
 * Per `specs/13-conversation/agent-loop.md` Stage 2: a small cheap
 * call classifies the message into a coarse intent. The intent tunes:
 *   - retrieval depth (none / shallow / deep)
 *   - which segments to focus on
 *   - which entities to resolve
 *
 * Runs on the background tier with `moonshotai/kimi-k2` and strict
 * JSON-mode output (schema below). Costs ~40 tokens out. Failure
 * modes (bad JSON, timeout) degrade to `intent='ask', depth='shallow'`
 * so the loop keeps going.
 */

import { z } from 'zod';

import type { ModelClient } from '@homehub/worker-runtime';

export const INTENTS = ['ask', 'plan', 'draft', 'act', 'edit-memory', 'other'] as const;
export type Intent = (typeof INTENTS)[number];

export const RETRIEVAL_DEPTHS = ['none', 'shallow', 'deep'] as const;
export type RetrievalDepth = (typeof RETRIEVAL_DEPTHS)[number];

export const intentResultSchema = z.object({
  intent: z.enum(INTENTS),
  entities: z.array(z.string()).max(10),
  retrieval_depth: z.enum(RETRIEVAL_DEPTHS),
  segments: z.array(z.enum(['financial', 'food', 'fun', 'social', 'system'])),
});

export type IntentResult = z.infer<typeof intentResultSchema>;

const INTENT_SYSTEM = [
  "You are a fast, deterministic router for a household assistant. Given the member's message,",
  'emit one JSON object with keys: intent, entities, retrieval_depth, segments.',
  '- intent: ask | plan | draft | act | edit-memory | other.',
  '- entities: short extracted names (persons, places, dishes, accounts).',
  '- retrieval_depth: none (pure small-talk) | shallow (one-hop lookup) | deep (multi-hop reasoning).',
  '- segments: any of financial, food, fun, social, system relevant to the request.',
  'Emit JSON only; no prose.',
].join(' ');

export async function classifyIntent(args: {
  modelClient: ModelClient;
  householdId: string;
  message: string;
}): Promise<IntentResult> {
  try {
    const res = await args.modelClient.generate({
      task: 'foreground.intent',
      household_id: args.householdId as never,
      systemPrompt: INTENT_SYSTEM,
      userPrompt: args.message,
      schema: intentResultSchema,
      maxOutputTokens: 80,
      cache: 'auto',
    });
    if (res.parsed) return res.parsed as IntentResult;
    throw new Error('intent: no parsed result');
  } catch {
    return {
      intent: 'ask',
      entities: [],
      retrieval_depth: 'shallow',
      segments: [],
    };
  }
}

export function retrievalParamsForDepth(depth: RetrievalDepth): {
  layers?: Array<'episodic' | 'semantic' | 'procedural'>;
  limit: number;
  max_depth: number;
} | null {
  switch (depth) {
    case 'none':
      return null;
    case 'shallow':
      return { layers: ['semantic'], limit: 5, max_depth: 1 };
    case 'deep':
      return { limit: 10, max_depth: 2 };
  }
}
