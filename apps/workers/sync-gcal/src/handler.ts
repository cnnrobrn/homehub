/**
 * `sync-gcal` handler.
 *
 * M0 stub. Intentional no-op — the real implementation lands in M2 under
 * @integrations and will:
 *   1. Claim pgmq messages from the `sync_gcal` queue (webhook fan-out).
 *   2. For each household connection, call Nango's Google Calendar proxy.
 *   3. Upsert normalized events into `app.event` on stable provider keys.
 *
 * See `specs/05-agents/workers.md` and `specs/03-integrations/google-calendar.md`.
 */

import { NotYetImplementedError } from '@homehub/worker-runtime';

/**
 * Stub handler. Preserves the eventual signature shape so unit tests in
 * this package pin it from day one; @integrations will replace the body
 * in M2 without changing the export.
 */
export async function handler(): Promise<void> {
  throw new NotYetImplementedError('sync-gcal handler not implemented until M2');
}
