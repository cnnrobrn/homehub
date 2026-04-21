/**
 * `reflector` handler.
 *
 * M0 stub. The real implementation lands in M3.7 under @memory-background;
 * see `specs/05-agents/workers.md` and the owner briefing.
 */

import { NotYetImplementedError } from '@homehub/worker-runtime';

/**
 * Stub handler. Preserves the eventual signature shape so unit tests in
 * this package pin it from day one; the owner replaces the body in
 * M3.7 without changing the export.
 */
export async function handler(): Promise<void> {
  throw new NotYetImplementedError('reflector handler not implemented until M3.7');
}
