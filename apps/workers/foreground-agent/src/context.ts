/**
 * Slotted context assembly.
 *
 * Per `specs/13-conversation/agent-loop.md` Stage 2. The output is
 * the full set of slots the foreground-model call consumes. Each slot
 * has a stable role: the `system` + `householdFacts` + `procedural`
 * block are the cached prefix; history + retrieval are the tail.
 */

import { retrievalParamsForDepth } from './intent.js';

import type { Intent, RetrievalDepth } from './intent.js';
import type { QueryMemoryClient, QueryMemoryResult } from '@homehub/query-memory';
import type { ServiceSupabaseClient } from '@homehub/worker-runtime';

export interface ConversationTurnRow {
  id: string;
  role: string;
  body_md: string;
  author_member_id: string | null;
  created_at: string;
  tool_calls: unknown;
  citations: unknown;
}

export interface AssembledContext {
  system: string;
  householdFacts: string;
  procedural: string;
  history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  retrieval: QueryMemoryResult | null;
  activeEntities: Array<{ id: string; name: string }>;
  pendingItems: {
    alerts: Array<{ id: string; title: string }>;
    suggestions: Array<{ id: string; title: string }>;
  };
}

const BASE_SYSTEM = [
  "You are HomeHub's assistant for a household. Be concise, plain-spoken, and accurate about uncertainty.",
  'Never sycophantic. Cite memory via bracket tags like [person:Sarah] or [episode:2026-04-12-dinner].',
  'Use tools before claiming facts. When a fact is conflicting or low-confidence, say so.',
  'Draft-write tools you call will be surfaced as approval cards; never claim an action auto-executed.',
  'Keep responses short unless the member asked for detail.',
].join(' ');

export async function loadConversationHistory(args: {
  supabase: ServiceSupabaseClient;
  conversationId: string;
  householdId: string;
  limit: number;
}): Promise<ConversationTurnRow[]> {
  const { data, error } = await args.supabase
    .schema('app')
    .from('conversation_turn')
    .select('id, role, body_md, author_member_id, created_at, tool_calls, citations')
    .eq('household_id', args.householdId)
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .limit(args.limit);
  if (error) throw new Error(`loadConversationHistory: ${error.message}`);
  return ((data ?? []) as ConversationTurnRow[]).reverse();
}

function historyToMessages(
  turns: ConversationTurnRow[],
): Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> = [];
  for (const t of turns) {
    if (t.role === 'member') out.push({ role: 'user', content: t.body_md });
    else if (t.role === 'assistant') out.push({ role: 'assistant', content: t.body_md });
    else if (t.role === 'tool') out.push({ role: 'tool', content: t.body_md });
    // `system` turns are context-only and don't replay.
  }
  return out;
}

async function loadHouseholdFacts(
  supabase: ServiceSupabaseClient,
  householdId: string,
): Promise<string> {
  // Thin roster + active rules. Kept small so the cached prefix stays stable.
  const [members, rules] = await Promise.all([
    supabase
      .schema('app')
      .from('member')
      .select('display_name, role')
      .eq('household_id', householdId)
      .order('joined_at', { ascending: true })
      .limit(20),
    supabase
      .schema('mem')
      .from('rule')
      .select('description')
      .eq('household_id', householdId)
      .eq('active', true)
      .limit(10),
  ]);
  const memberLine = (members.data ?? []).map((m) => `${m.display_name} (${m.role})`).join(', ');
  const ruleLines = (rules.data ?? []).map((r) => `- ${r.description}`).join('\n');
  return [
    memberLine ? `Members: ${memberLine}.` : '',
    ruleLines ? `Active rules:\n${ruleLines}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function loadPendingItems(
  supabase: ServiceSupabaseClient,
  householdId: string,
): Promise<AssembledContext['pendingItems']> {
  const [alertsRes, suggestionsRes] = await Promise.all([
    supabase
      .schema('app')
      .from('alert')
      .select('id, title')
      .eq('household_id', householdId)
      .is('dismissed_at', null)
      .order('generated_at', { ascending: false })
      .limit(5),
    supabase
      .schema('app')
      .from('suggestion')
      .select('id, title')
      .eq('household_id', householdId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);
  return {
    alerts: (alertsRes.data ?? []) as Array<{ id: string; title: string }>,
    suggestions: (suggestionsRes.data ?? []) as Array<{ id: string; title: string }>,
  };
}

async function resolveActiveEntities(
  supabase: ServiceSupabaseClient,
  householdId: string,
  message: string,
): Promise<Array<{ id: string; name: string }>> {
  const matches = Array.from(message.matchAll(/\[node:([0-9a-f-]{36})\]/gi)).map((m) => m[1]!);
  if (matches.length === 0) return [];
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('id, canonical_name')
    .eq('household_id', householdId)
    .in('id', matches);
  if (error) return [];
  return ((data ?? []) as Array<{ id: string; canonical_name: string }>).map((n) => ({
    id: n.id,
    name: n.canonical_name,
  }));
}

export interface AssembleContextInput {
  supabase: ServiceSupabaseClient;
  queryMemory: QueryMemoryClient;
  householdId: string;
  conversationId: string;
  message: string;
  intent: Intent;
  retrievalDepth: RetrievalDepth;
  segments: string[];
  historyLimit?: number;
}

export async function assembleContext(input: AssembleContextInput): Promise<AssembledContext> {
  const [history, householdFacts, activeEntities, pendingItems] = await Promise.all([
    loadConversationHistory({
      supabase: input.supabase,
      conversationId: input.conversationId,
      householdId: input.householdId,
      limit: input.historyLimit ?? 20,
    }),
    loadHouseholdFacts(input.supabase, input.householdId),
    resolveActiveEntities(input.supabase, input.householdId, input.message),
    loadPendingItems(input.supabase, input.householdId),
  ]);

  const retrievalParams = retrievalParamsForDepth(input.retrievalDepth);
  let retrieval: QueryMemoryResult | null = null;
  if (retrievalParams) {
    try {
      retrieval = await input.queryMemory.query({
        householdId: input.householdId as never,
        query: input.message,
        limit: retrievalParams.limit,
        max_depth: retrievalParams.max_depth,
        ...(retrievalParams.layers ? { layers: retrievalParams.layers } : {}),
      });
    } catch {
      retrieval = null;
    }
  }

  const procedural = (retrieval?.patterns ?? []).map((p) => `- ${p.description}`).join('\n') || '';

  return {
    system: BASE_SYSTEM,
    householdFacts,
    procedural,
    history: historyToMessages(history),
    retrieval,
    activeEntities,
    pendingItems,
  };
}

/**
 * Render the retrieval slot as a short text block we attach to the
 * user turn (separate from the cached prefix so retrieval changes per
 * turn don't bust the cache).
 */
export function renderRetrievalForPrompt(ctx: AssembledContext): string {
  const parts: string[] = [];
  if (ctx.retrieval) {
    if (ctx.retrieval.nodes.length > 0) {
      parts.push(
        'Relevant nodes:\n' +
          ctx.retrieval.nodes
            .slice(0, 8)
            .map((n) => `- [node:${n.id}] ${n.canonical_name} (${n.type})`)
            .join('\n'),
      );
    }
    if (ctx.retrieval.facts.length > 0) {
      parts.push(
        'Relevant facts:\n' +
          ctx.retrieval.facts
            .slice(0, 10)
            .map(
              (f) =>
                `- ${f.predicate} (conf ${Math.round(
                  (f.confidence ?? 0) * 100,
                )}%, ${f.conflict_status ?? 'none'})`,
            )
            .join('\n'),
      );
    }
    if (ctx.retrieval.conflicts.length > 0) {
      parts.push(
        `Conflicts detected (${ctx.retrieval.conflicts.length}). Mention uncertainty if you use these.`,
      );
    }
    if (ctx.retrieval.episodes.length > 0) {
      parts.push(
        'Recent episodes:\n' +
          ctx.retrieval.episodes
            .slice(0, 5)
            .map((e) => `- [episode:${e.id}] ${e.title}`)
            .join('\n'),
      );
    }
  }
  if (ctx.activeEntities.length > 0) {
    parts.push(
      '@-mentioned entities:\n' +
        ctx.activeEntities.map((e) => `- [node:${e.id}] ${e.name}`).join('\n'),
    );
  }
  if (ctx.pendingItems.alerts.length > 0) {
    parts.push('Pending alerts:\n' + ctx.pendingItems.alerts.map((a) => `- ${a.title}`).join('\n'));
  }
  if (ctx.pendingItems.suggestions.length > 0) {
    parts.push(
      'Pending suggestions:\n' + ctx.pendingItems.suggestions.map((s) => `- ${s.title}`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

/** Build the full cached prefix: system + household + procedural. */
export function buildSystemPrefix(ctx: AssembledContext): string {
  const chunks: string[] = [ctx.system];
  if (ctx.householdFacts) chunks.push(`Household context:\n${ctx.householdFacts}`);
  if (ctx.procedural) chunks.push(`Relevant household patterns:\n${ctx.procedural}`);
  chunks.push(
    'Tool rules: call a read tool before asserting a fact. Draft-write tools render as member approval cards; never claim they auto-executed.',
  );
  return chunks.join('\n\n');
}
