/**
 * `reconciler` handler.
 *
 * M0 stub. The real implementation lands in M3/M5 under @integrations + @memory-background;
 * see `specs/05-agents/workers.md` and the owner briefing.
 */

import { NotYetImplementedError } from '@homehub/worker-runtime';

/**
 * Stub handler. Preserves the eventual signature shape so unit tests in
 * this package pin it from day one; the owner replaces the body in
 * M3/M5 without changing the export.
 */
export async function handler(): Promise<void> {
  throw new NotYetImplementedError('reconciler handler not implemented until M3/M5');
}
