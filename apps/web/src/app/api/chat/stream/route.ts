/**
 * POST /api/chat/stream
 *
 * Streaming endpoint for conversation turns. Persists the member
 * turn, invokes the foreground agent loop, and pipes every stream
 * event back to the browser as Server-Sent Events.
 *
 * Body:
 *   { conversationId: string, message: string }
 *
 * The route handler:
 *   1. Resolves the caller's household context (fails 401/403).
 *   2. Inserts the `conversation_turn` for the member.
 *   3. Calls `runConversationTurnStream()` from
 *      `@homehub/worker-foreground-agent` directly — for M3.5 the
 *      same Node runtime executes both, skipping an extra network
 *      hop. The `foreground-agent` worker still exists for the
 *      future edge-worker split.
 *   4. Encodes each `AgentStreamEvent` as an SSE `data:` line.
 *
 * Streaming is via `ReadableStream` — the Web Standard surface Next
 * supports from a Route Handler. Keep this file server-only.
 */

import {
  UnauthorizedError,
  createServiceClient,
  getUser,
  resolveMemberId,
} from '@homehub/auth-server';
import { createQueryMemory } from '@homehub/query-memory';
import {
  runConversationTurnStream,
  createOpenRouterForegroundModel,
  type AgentStreamEvent,
} from '@homehub/worker-foreground-agent';
import { createModelClient } from '@homehub/worker-runtime';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getHouseholdContext } from '@/lib/auth/context';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';
import { memoryRuntimeEnv } from '@/lib/memory/runtime-env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(8000),
});

function encodeEvent(event: AgentStreamEvent): Uint8Array {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  return new TextEncoder().encode(payload);
}

export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const env = authEnv();
  const cookies = await nextCookieAdapter();
  const user = await getUser(env, cookies);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ctx = await getHouseholdContext();
  if (!ctx) return NextResponse.json({ error: 'no_household' }, { status: 403 });

  const service = createServiceClient(env);

  // Confirm the conversation belongs to this household.
  const { data: conv, error: convErr } = await service
    .schema('app')
    .from('conversation')
    .select('id, household_id')
    .eq('id', parsed.data.conversationId)
    .maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: 'conversation_lookup_failed' }, { status: 500 });
  }
  if (!conv || conv.household_id !== ctx.household.id) {
    return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });
  }

  const memberId = await resolveMemberId(service, ctx.household.id as string, user.id);
  if (!memberId) {
    // shouldn't hit — getHouseholdContext already resolved it.
    throw new UnauthorizedError('member resolution failed');
  }

  // Persist the member turn BEFORE starting the stream so a refresh
  // mid-stream still shows the member's message.
  const { data: memberTurn, error: turnErr } = await service
    .schema('app')
    .from('conversation_turn')
    .insert({
      conversation_id: parsed.data.conversationId,
      household_id: ctx.household.id as string,
      author_member_id: memberId,
      role: 'member',
      body_md: parsed.data.message,
    })
    .select('id')
    .single();
  if (turnErr) {
    return NextResponse.json(
      { error: 'turn_insert_failed', message: turnErr.message },
      { status: 500 },
    );
  }

  // Build the foreground-agent deps.
  const runtimeEnv = memoryRuntimeEnv();
  const log = {
    trace: () => {},
    debug: () => {},
    info: (m: string, ctx?: Record<string, unknown>) => console.log(`[chat] ${m}`, ctx ?? {}),
    warn: (m: string, ctx?: Record<string, unknown>) => console.warn(`[chat] ${m}`, ctx ?? {}),
    error: (m: string, ctx?: Record<string, unknown>) => console.error(`[chat] ${m}`, ctx ?? {}),
    fatal: (m: string, ctx?: Record<string, unknown>) =>
      console.error(`[chat:fatal] ${m}`, ctx ?? {}),
    child() {
      return this;
    },
  };
  const modelClient = createModelClient(runtimeEnv, { supabase: service, logger: log });
  const queryMemory = createQueryMemory({ supabase: service, modelClient, log });
  const foregroundModel = createOpenRouterForegroundModel(runtimeEnv, {
    supabase: service,
    logger: log,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runConversationTurnStream(
          {
            conversationId: parsed.data.conversationId,
            turnId: memberTurn.id,
            memberMessage: parsed.data.message,
            memberContext: {
              householdId: ctx.household.id,
              memberId: memberId as never,
              memberRole: ctx.member.role === 'non_connected' ? 'guest' : ctx.member.role,
              grants: ctx.grants.map((g) => ({ segment: g.segment, access: g.access })),
            },
          },
          {
            supabase: service,
            queryMemory,
            modelClient,
            foregroundModel,
            queue: null,
            logger: log,
          },
        )) {
          controller.enqueue(encodeEvent(event));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'internal error';
        controller.enqueue(encodeEvent({ type: 'error', message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
