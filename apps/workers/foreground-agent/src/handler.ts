/**
 * Foreground conversation-turn runner.
 *
 * Per `specs/13-conversation/agent-loop.md`:
 *   1. ingest       — caller has persisted the member turn; we fire an
 *                     async extraction queue message (non-blocking).
 *   2. context      — intent prefilter → slotted context assembly.
 *   3. model        — foreground-tier call with tool catalog.
 *   4. tool calls   — serial. Read = run + feed back; direct-write =
 *                     run + feed back + audit; draft-write = stub +
 *                     feed back "pending approval" + emit suggestion
 *                     card event.
 *   5. stream       — events yielded to the caller. Route handler
 *                     translates to SSE.
 *   6. post-turn    — persist assistant turn, audit, enqueue rollup.
 *
 * The loop is pure — it yields events (`AgentStreamEvent[]`) via an
 * async generator and does not own the transport. The web Route
 * Handler wraps it in a ReadableStream.
 */

import {
  createToolCatalog,
  readableSegments,
  type ToolCatalog,
  type ToolContext,
} from '@homehub/tools';
import { NotYetImplementedError, queueNames } from '@homehub/worker-runtime';

import { assembleContext, buildSystemPrefix, renderRetrievalForPrompt } from './context.js';
import { classifyIntent } from './intent.js';

import type { AgentStreamEvent } from './events.js';
import type { ForegroundMessage, ForegroundModel, ForegroundToolCall } from './model.js';
import type { QueryMemoryClient } from '@homehub/query-memory';
import type { HouseholdId, MemberId } from '@homehub/shared';
import type {
  ModelClient,
  QueueClient,
  ServiceSupabaseClient,
  Logger,
} from '@homehub/worker-runtime';

export type { AgentStreamEvent } from './events.js';
export { createOpenRouterForegroundModel } from './model.js';
export type { ForegroundModel } from './model.js';

const MAX_TOOL_ITERATIONS = 5;
const CHUNK_SIZE = 48; // bytes-ish per token event; makes the UI feel live
const SETUP_SURFACE_IDS = ['calendar', 'decisions'] as const;
type SetupSurfaceId = (typeof SETUP_SURFACE_IDS)[number];

export interface ConversationTurnInput {
  readonly conversationId: string;
  readonly turnId: string;
  /** The text of the member turn (already persisted to DB). */
  readonly memberMessage: string;
  readonly memberContext: {
    householdId: HouseholdId;
    memberId: MemberId;
    memberRole: 'owner' | 'adult' | 'child' | 'guest' | 'non_connected';
    grants: Array<{
      segment: 'financial' | 'food' | 'fun' | 'social' | 'system';
      access: 'none' | 'read' | 'write';
    }>;
  };
}

export interface RunConversationTurnDeps {
  supabase: ServiceSupabaseClient;
  queryMemory: QueryMemoryClient;
  modelClient: ModelClient;
  foregroundModel: ForegroundModel;
  queue?: QueueClient | null;
  logger: Logger;
  /** Injectable for deterministic tests. */
  now?: () => Date;
  /** Injectable for tests that assert catalog-dispatch wiring. */
  catalogFactory?: (ctx: ToolContext) => ToolCatalog;
}

/**
 * Persist the assistant turn. Creates an empty row at the start so
 * the member can refresh mid-stream and see progress-so-far; updates
 * to the final body + metadata at the end.
 */
async function upsertAssistantTurn(args: {
  supabase: ServiceSupabaseClient;
  conversationId: string;
  householdId: string;
  row: {
    body_md: string;
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_cents: number | null;
    tool_calls: unknown;
    citations: unknown;
  };
  existingTurnId?: string;
}): Promise<string> {
  if (args.existingTurnId) {
    const { error } = await args.supabase
      .schema('app')
      .from('conversation_turn')
      .update({
        body_md: args.row.body_md,
        model: args.row.model,
        input_tokens: args.row.input_tokens,
        output_tokens: args.row.output_tokens,
        cost_cents: args.row.cost_cents,
        tool_calls: args.row.tool_calls as never,
        citations: args.row.citations as never,
      })
      .eq('id', args.existingTurnId);
    if (error) throw new Error(`upsertAssistantTurn update: ${error.message}`);
    return args.existingTurnId;
  }
  const { data, error } = await args.supabase
    .schema('app')
    .from('conversation_turn')
    .insert({
      conversation_id: args.conversationId,
      household_id: args.householdId,
      role: 'assistant',
      body_md: args.row.body_md,
      model: args.row.model,
      input_tokens: args.row.input_tokens,
      output_tokens: args.row.output_tokens,
      cost_cents: args.row.cost_cents,
      tool_calls: args.row.tool_calls as never,
      citations: args.row.citations as never,
    })
    .select('id')
    .single();
  if (error) throw new Error(`upsertAssistantTurn insert: ${error.message}`);
  return data.id;
}

async function bumpConversationActivity(args: {
  supabase: ServiceSupabaseClient;
  conversationId: string;
  householdId: string;
  now: Date;
}): Promise<void> {
  await args.supabase
    .schema('app')
    .from('conversation')
    .update({ last_message_at: args.now.toISOString() })
    .eq('id', args.conversationId)
    .eq('household_id', args.householdId);
}

async function enqueueExtraction(args: {
  queue: QueueClient | null | undefined;
  householdId: string;
  conversationId: string;
  turnId: string;
  now: Date;
  logger: Logger;
}): Promise<void> {
  if (!args.queue) return;
  try {
    await args.queue.send(queueNames.enrichConversation, {
      household_id: args.householdId,
      kind: 'member_turn',
      entity_id: args.turnId,
      version: 0,
      enqueued_at: args.now.toISOString(),
    });
  } catch (err) {
    args.logger.warn('enqueue enrich_conversation failed (non-fatal)', {
      household_id: args.householdId,
      turn_id: args.turnId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function enqueueRollup(args: {
  queue: QueueClient | null | undefined;
  householdId: string;
  conversationId: string;
  now: Date;
  logger: Logger;
}): Promise<void> {
  if (!args.queue) return;
  try {
    await args.queue.send(queueNames.rollupConversation, {
      household_id: args.householdId,
      kind: 'conversation',
      entity_id: args.conversationId,
      version: 0,
      enqueued_at: args.now.toISOString(),
    });
  } catch (err) {
    args.logger.warn('enqueue rollup_conversation failed (non-fatal)', {
      household_id: args.householdId,
      conversation_id: args.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function extractCitations(text: string): Array<{ type: 'node' | 'episode'; id: string }> {
  const out: Array<{ type: 'node' | 'episode'; id: string }> = [];
  const re = /\[(node|episode):([0-9a-f-]{36})\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ type: m[1]! as 'node' | 'episode', id: m[2]! });
  }
  return out;
}

function chunkText(text: string, size: number): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSurfaces(items: readonly SetupSurfaceId[]): SetupSurfaceId[] {
  return SETUP_SURFACE_IDS.filter((id) => items.includes(id));
}

function resultArrayHasItems(result: unknown, key: string): boolean {
  return isRecord(result) && Array.isArray(result[key]) && result[key].length > 0;
}

function surfacesForToolCall(args: {
  tool: string;
  classification: string;
  result: unknown;
}): SetupSurfaceId[] {
  const surfaces: SetupSurfaceId[] = [];
  if (args.tool === 'list_events' && resultArrayHasItems(args.result, 'events')) {
    surfaces.push('calendar');
  }
  if (
    args.classification === 'draft-write' ||
    (args.tool === 'list_suggestions' && resultArrayHasItems(args.result, 'suggestions'))
  ) {
    surfaces.push('decisions');
  }
  return uniqueSurfaces(surfaces);
}

async function recordOnboardingSurfaceProgress(args: {
  supabase: ServiceSupabaseClient;
  householdId: string;
  surfaces: readonly SetupSurfaceId[];
  now: Date;
  logger: Logger;
}): Promise<void> {
  const surfaces = uniqueSurfaces(args.surfaces);
  if (surfaces.length === 0) return;

  const { data, error } = await args.supabase
    .schema('app')
    .from('household')
    .select('settings')
    .eq('id', args.householdId)
    .single();
  if (error) {
    args.logger.warn('onboarding surface progress skipped: household lookup failed', {
      household_id: args.householdId,
      surfaces,
      error: error.message,
    });
    return;
  }

  const currentSettings = isRecord((data as { settings?: unknown } | null)?.settings)
    ? (data as { settings: Record<string, unknown> }).settings
    : {};
  const currentOnboarding = isRecord(currentSettings.onboarding)
    ? (currentSettings.onboarding as Record<string, unknown>)
    : null;

  // Only households with onboarding state track this progress metadata.
  if (!currentOnboarding || !Array.isArray(currentOnboarding.setup_segments)) return;

  const existingSurfaceIds = Array.isArray(currentOnboarding.setup_surface_ids)
    ? currentOnboarding.setup_surface_ids.filter(
        (id): id is SetupSurfaceId =>
          typeof id === 'string' && SETUP_SURFACE_IDS.includes(id as SetupSurfaceId),
      )
    : [];
  const nextSurfaceIds = uniqueSurfaces([...existingSurfaceIds, ...surfaces]);
  if (nextSurfaceIds.length === existingSurfaceIds.length) return;

  const settings = {
    ...currentSettings,
    onboarding: {
      ...currentOnboarding,
      setup_surface_ids: nextSurfaceIds,
      last_onboarded_at: args.now.toISOString(),
    },
  };

  const { error: updateError } = await args.supabase
    .schema('app')
    .from('household')
    .update({ settings: settings as never })
    .eq('id', args.householdId);
  if (updateError) {
    args.logger.warn('onboarding surface progress skipped: household update failed', {
      household_id: args.householdId,
      surfaces,
      error: updateError.message,
    });
  }
}

/**
 * Run a single conversation turn. Yields events in order; the caller
 * is responsible for transporting them to the client. Throws on hard
 * errors; soft errors (tool failures, etc.) surface as events.
 */
export async function* runConversationTurnStream(
  input: ConversationTurnInput,
  deps: RunConversationTurnDeps,
): AsyncGenerator<AgentStreamEvent, void, void> {
  const log = deps.logger.child({
    household_id: input.memberContext.householdId as string,
    conversation_id: input.conversationId,
    turn_id: input.turnId,
  });
  const now = deps.now ?? (() => new Date());
  const factory = deps.catalogFactory ?? createToolCatalog;

  yield { type: 'start', turnId: input.turnId, conversationId: input.conversationId };

  // Stage 1 — async extraction (fire and forget).
  void enqueueExtraction({
    queue: deps.queue ?? null,
    householdId: input.memberContext.householdId as string,
    conversationId: input.conversationId,
    turnId: input.turnId,
    now: now(),
    logger: log,
  });

  // Stage 2a — intent prefilter.
  const intent = await classifyIntent({
    modelClient: deps.modelClient,
    householdId: input.memberContext.householdId as string,
    message: input.memberMessage,
  });
  yield {
    type: 'intent',
    intent: intent.intent,
    retrieval_depth: intent.retrieval_depth,
    segments: intent.segments,
  };

  // Stage 2b — context assembly.
  const ctx = await assembleContext({
    supabase: deps.supabase,
    queryMemory: deps.queryMemory,
    householdId: input.memberContext.householdId as string,
    conversationId: input.conversationId,
    message: input.memberMessage,
    intent: intent.intent,
    retrievalDepth: intent.retrieval_depth,
    segments: intent.segments,
  });

  // Catalog + tool scope.
  const toolCtx: ToolContext = {
    householdId: input.memberContext.householdId,
    memberId: input.memberContext.memberId,
    memberRole: input.memberContext.memberRole,
    grants: input.memberContext.grants,
    supabase: deps.supabase,
    queryMemory: deps.queryMemory,
    log,
    ...(deps.now ? { now: deps.now } : {}),
  };
  const catalog = factory(toolCtx);
  const scope = readableSegments(toolCtx.grants);
  const toolSpecs = catalog.forModel(scope);

  // Build conversation-style message list. The retrieval block rides
  // as a system-reminder message appended AFTER the stable prefix so
  // prompt caching on the prefix still holds.
  const retrievalBlock = renderRetrievalForPrompt(ctx);
  const systemPrefix = buildSystemPrefix(ctx);
  const messages: ForegroundMessage[] = [];
  for (const h of ctx.history) {
    messages.push({ role: h.role === 'tool' ? 'assistant' : h.role, content: h.content });
  }
  if (retrievalBlock) {
    messages.push({ role: 'user', content: `[context]\n${retrievalBlock}` });
  }
  messages.push({ role: 'user', content: input.memberMessage });

  // Stage 3/4 — model + serial tool loop.
  let inputTokenTotal = 0;
  let outputTokenTotal = 0;
  let costTotal = 0;
  let assistantText = '';
  let modelName = '';
  const toolCallLog: Array<{
    id: string;
    tool: string;
    classification: string;
    arguments: unknown;
    result: unknown;
    latency_ms: number;
    ok: boolean;
    error?: { code: string; message: string };
  }> = [];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter += 1) {
    const response = await deps.foregroundModel.generate({
      task: 'foreground',
      household_id: input.memberContext.householdId,
      systemPrompt: systemPrefix,
      messages,
      tools: toolSpecs,
      cache: 'auto',
    });
    inputTokenTotal += response.inputTokens;
    outputTokenTotal += response.outputTokens;
    costTotal += response.costUsd;
    modelName = response.model;

    if (response.toolCalls.length === 0) {
      assistantText = response.assistantText;
      messages.push({ role: 'assistant', content: response.assistantText });
      break;
    }

    messages.push({
      role: 'assistant',
      content: response.assistantText,
      toolCalls: response.toolCalls,
    });

    // Serial tool execution.
    for (const call of response.toolCalls) {
      yield {
        type: 'tool_call_start',
        callId: call.id,
        tool: call.name,
        arguments: call.arguments,
        classification: catalog.definition(call.name)?.class ?? null,
      };
      const startedCall = Date.now();
      const result = await catalog.call(call.name, call.arguments);
      const latency = Date.now() - startedCall;
      if (result.ok) {
        toolCallLog.push({
          id: call.id,
          tool: call.name,
          classification: result.classification,
          arguments: call.arguments,
          result: result.result,
          latency_ms: latency,
          ok: true,
        });
        yield {
          type: 'tool_call_done',
          callId: call.id,
          tool: call.name,
          classification: result.classification,
          result: result.result,
          latencyMs: latency,
        };
        if (result.classification === 'draft-write') {
          const maybePreview = (result.result as Record<string, unknown>) ?? {};
          yield {
            type: 'suggestion_card',
            callId: call.id,
            tool: call.name,
            summary:
              typeof maybePreview.summary === 'string'
                ? (maybePreview.summary as string)
                : `${call.name} pending approval`,
            preview: (maybePreview.preview as unknown) ?? null,
          };
        }
        await recordOnboardingSurfaceProgress({
          supabase: deps.supabase,
          householdId: input.memberContext.householdId as string,
          surfaces: surfacesForToolCall({
            tool: call.name,
            classification: result.classification,
            result: result.result,
          }),
          now: now(),
          logger: log,
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(result.result).slice(0, 12_000),
        });
      } else {
        toolCallLog.push({
          id: call.id,
          tool: call.name,
          classification: 'read',
          arguments: call.arguments,
          result: null,
          latency_ms: latency,
          ok: false,
          error: { code: result.error.code, message: result.error.message },
        });
        yield {
          type: 'tool_call_error',
          callId: call.id,
          tool: call.name,
          error: { code: result.error.code, message: result.error.message },
        };
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ error: result.error }),
        });
      }
    }
  }

  // Stage 5 — stream tokens. We don't have true server-side streaming
  // yet; chunk the final text so the UI still renders progressively.
  for (const chunk of chunkText(assistantText, CHUNK_SIZE)) {
    yield { type: 'token', delta: chunk };
  }

  // Resolve citations in the text to node ids (best-effort: we don't
  // block the final event on validation).
  const rawCitations = extractCitations(assistantText);
  for (const c of rawCitations) {
    if (c.type === 'node') {
      yield {
        type: 'citation',
        chip: `[node:${c.id}]`,
        nodeId: c.id,
        label: c.id.slice(0, 8),
      };
    }
  }

  // Stage 6 — persist + post-turn writes.
  const costCents = Math.round(costTotal * 100 * 100) / 100; // cents, 2dp precision
  const assistantTurnId = await upsertAssistantTurn({
    supabase: deps.supabase,
    conversationId: input.conversationId,
    householdId: input.memberContext.householdId as string,
    row: {
      body_md: assistantText || '(no response)',
      model: modelName || null,
      input_tokens: inputTokenTotal || null,
      output_tokens: outputTokenTotal || null,
      cost_cents: costCents || null,
      tool_calls: toolCallLog,
      citations: rawCitations,
    },
  });

  await bumpConversationActivity({
    supabase: deps.supabase,
    conversationId: input.conversationId,
    householdId: input.memberContext.householdId as string,
    now: now(),
  });

  // Rollup heuristic.
  const substantive =
    toolCallLog.length > 0 || assistantText.length > 300 || rawCitations.length >= 2;
  if (substantive) {
    void enqueueRollup({
      queue: deps.queue ?? null,
      householdId: input.memberContext.householdId as string,
      conversationId: input.conversationId,
      now: now(),
      logger: log,
    });
  }

  yield {
    type: 'final',
    turnId: assistantTurnId,
    conversationId: input.conversationId,
    assistantBody: assistantText,
    toolCalls: toolCallLog,
    citations: rawCitations,
    model: modelName,
    inputTokens: inputTokenTotal,
    outputTokens: outputTokenTotal,
    costUsd: costTotal,
  };
}

/**
 * Back-compat: the M0 stub accepted `{ conversationId, turnId }` only.
 * The M3.5 signature requires the member message + context, so this
 * overload exists to surface the migration clearly. If callers invoke
 * the old shape, we throw a meaningful error rather than hanging.
 */
export async function runConversationTurn(
  input: ConversationTurnInput,
  deps?: RunConversationTurnDeps,
): Promise<void> {
  if (!deps) {
    throw new NotYetImplementedError(
      'runConversationTurn now requires a deps bundle (supabase, queryMemory, modelClient, foregroundModel). See handler.ts.',
    );
  }
  for await (const _ of runConversationTurnStream(input, deps)) {
    // drain; web route handler uses the generator directly.
    void _;
  }
}

export const handler = runConversationTurn;

/**
 * Collect an async generator into an array — test helper.
 */
export async function collectStream<T>(iter: AsyncGenerator<T, void, void>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

// Re-export the tool-call type for web route handlers that need to
// type the SSE payload without cross-imports through this file.
export type { ForegroundToolCall };

// Prevent unused lint when deps module is loaded but tooling not invoked.
export type { RunConversationTurnDeps as ForegroundAgentDeps };
