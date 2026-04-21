/**
 * `action-executor` handler.
 *
 * M0 stub. The real implementation lands in M9 under @integrations + @memory-background;
 * see `specs/05-agents/workers.md` and the owner briefing.
 */

import { NotYetImplementedError } from '@homehub/worker-runtime';

/**
 * Stub handler. Preserves the eventual signature shape so unit tests in
 * this package pin it from day one; the owner replaces the body in
 * M9 without changing the export.
 */
export async function handler(): Promise<void> {
  throw new NotYetImplementedError('action-executor handler not implemented until M9');
}
