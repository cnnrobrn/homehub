/**
 * Server actions for the `/ops/*` internal surfaces.
 *
 * Every action here is **owner-only** and scoped to the caller's current
 * household. Even though the `/ops` layout re-checks the role on render,
 * the server actions must re-check it — a crafted fetch could POST to
 * a non-owner and bypass the UI gate.
 *
 * Actions implemented:
 *   - listDlqEntriesAction — read (used by the Refresh button).
 *   - replayDlqEntryAction — re-enqueue a failed message.
 *   - purgeDlqEntryAction  — delete a DLQ row.
 *   - requestHouseholdExportAction — enqueue an export job.
 *
 * All actions audit-write (`audit.event`) so operators can trace who
 * replayed / purged / exported what. Audit writes never fail the
 * business operation; a warning is logged and the caller continues.
 */

'use server';

import {
  UnauthorizedError,
  createServiceClient,
  getUser,
  resolveMemberId,
  writeAuditEvent,
} from '@homehub/auth-server';
import { listDeadLetters, purgeDeadLetter, replayDeadLetter } from '@homehub/dlq-admin';
import { createQueueClient } from '@homehub/worker-runtime';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { getHouseholdContext } from '@/lib/auth/context';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';

type ServiceClient = ReturnType<typeof createServiceClient>;

interface OwnerActor {
  userId: string;
  householdId: string;
  memberId: string;
  service: ServiceClient;
}

/**
 * Resolve the current caller as an owner of their household. Returns the
 * actor + service client. Throws `UnauthorizedError` if no session or
 * not an owner of a household.
 */
async function requireOwnerActor(): Promise<OwnerActor> {
  const env = authEnv();
  const cookies = await nextCookieAdapter();
  const user = await getUser(env, cookies);
  if (!user) throw new UnauthorizedError('no session');
  const ctx = await getHouseholdContext();
  if (!ctx) throw new UnauthorizedError('no household');
  if (ctx.member.role !== 'owner') throw new UnauthorizedError('owner role required');
  const service = createServiceClient(env);
  const memberId = await resolveMemberId(service, ctx.household.id, user.id);
  if (!memberId) throw new UnauthorizedError('member lookup failed');
  return {
    userId: user.id,
    householdId: ctx.household.id,
    memberId,
    service,
  };
}

// ---------------------------------------------------------------------------
// listDlqEntriesAction
// ---------------------------------------------------------------------------

const listDlqSchema = z.object({
  queue: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function listDlqEntriesAction(input: z.input<typeof listDlqSchema>): Promise<
  ActionResult<{
    entries: Array<{
      id: string;
      queue: string;
      error: string;
      receivedAt: string;
      messageId: number | null;
    }>;
  }>
> {
  try {
    const parsed = listDlqSchema.parse(input);
    const actor = await requireOwnerActor();
    const entries = await listDeadLetters(actor.service, {
      householdId: actor.householdId,
      ...(parsed.queue ? { queue: parsed.queue } : {}),
      ...(parsed.limit ? { limit: parsed.limit } : {}),
    });
    return ok({
      entries: entries.map((e) => ({
        id: e.id,
        queue: e.queue,
        error: e.error,
        receivedAt: e.receivedAt,
        messageId: e.messageId,
      })),
    });
  } catch (err) {
    return toErr(err);
  }
}

// ---------------------------------------------------------------------------
// replayDlqEntryAction
// ---------------------------------------------------------------------------

const replayDlqSchema = z.object({ id: z.string().uuid() });

export async function replayDlqEntryAction(
  input: z.input<typeof replayDlqSchema>,
): Promise<ActionResult<{ enqueued: boolean; reason?: string }>> {
  try {
    const parsed = replayDlqSchema.parse(input);
    const actor = await requireOwnerActor();
    const queues = createQueueClient(actor.service);
    const result = await replayDeadLetter(actor.service, queues, parsed.id);
    await writeAuditEvent(
      actor.service,
      {
        household_id: actor.householdId,
        actor_user_id: actor.userId,
        action: 'ops.dlq.replay',
        resource_type: 'sync.dead_letter',
        resource_id: parsed.id,
        after: {
          enqueued: result.enqueued,
          ...(result.reason ? { reason: result.reason } : {}),
        },
      },
      (e) => console.warn('[ops] audit write failed (dlq.replay)', e),
    );
    return ok({
      enqueued: result.enqueued,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  } catch (err) {
    return toErr(err);
  }
}

// ---------------------------------------------------------------------------
// purgeDlqEntryAction
// ---------------------------------------------------------------------------

const purgeDlqSchema = z.object({ id: z.string().uuid() });

export async function purgeDlqEntryAction(
  input: z.input<typeof purgeDlqSchema>,
): Promise<ActionResult<{ purged: boolean }>> {
  try {
    const parsed = purgeDlqSchema.parse(input);
    const actor = await requireOwnerActor();
    await purgeDeadLetter(actor.service, parsed.id);
    await writeAuditEvent(
      actor.service,
      {
        household_id: actor.householdId,
        actor_user_id: actor.userId,
        action: 'ops.dlq.purge',
        resource_type: 'sync.dead_letter',
        resource_id: parsed.id,
      },
      (e) => console.warn('[ops] audit write failed (dlq.purge)', e),
    );
    return ok({ purged: true });
  } catch (err) {
    return toErr(err);
  }
}

// ---------------------------------------------------------------------------
// requestHouseholdExportAction
// ---------------------------------------------------------------------------

const exportSchema = z.object({});

export async function requestHouseholdExportAction(
  _input: z.input<typeof exportSchema>,
): Promise<ActionResult<{ requestId: string | null; queued: boolean; reason?: string }>> {
  try {
    exportSchema.parse(_input);
    const actor = await requireOwnerActor();

    // Try to record the request row. `sync.household_export` lands in
    // the pending migration (see docs/ops/backup-restore.md). Until
    // then, surface a friendly queued-but-pending response so the UI
    // can tell the operator the request is effectively a no-op.
    const serviceMaybe = actor.service as unknown as {
      schema: (name: string) => {
        from: (t: string) => {
          insert: (v: unknown) => {
            select: (c: string) => {
              maybeSingle: () => Promise<{
                data: { id: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
    let requestId: string | null = null;
    let queued = false;
    let reason: string | undefined;
    try {
      const { data, error } = await serviceMaybe
        .schema('sync')
        .from('household_export')
        .insert({
          household_id: actor.householdId,
          requested_by_member_id: actor.memberId,
          status: 'pending',
        })
        .select('id')
        .maybeSingle();
      if (error) {
        reason = `insert failed: ${error.message}`;
      } else if (data?.id) {
        requestId = data.id;
        queued = true;
      }
    } catch (e) {
      reason = `table unavailable: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Attempt to send a pgmq message so the export worker can pick it
    // up. This can be skipped gracefully when the queue is not yet
    // provisioned — operators see the request row and can replay later.
    if (queued && requestId) {
      try {
        const queues = createQueueClient(actor.service);
        await queues.send('household_export', {
          household_id: actor.householdId,
          kind: 'household.export',
          entity_id: requestId,
          version: 1,
          enqueued_at: new Date().toISOString(),
        });
      } catch (e) {
        reason = `enqueue failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    await writeAuditEvent(
      actor.service,
      {
        household_id: actor.householdId,
        actor_user_id: actor.userId,
        action: 'ops.household_export.request',
        resource_type: 'sync.household_export',
        resource_id: requestId,
        after: { queued, ...(reason ? { reason } : {}) },
      },
      (e) => console.warn('[ops] audit write failed (export.request)', e),
    );

    return ok({ requestId, queued, ...(reason ? { reason } : {}) });
  } catch (err) {
    return toErr(err);
  }
}
