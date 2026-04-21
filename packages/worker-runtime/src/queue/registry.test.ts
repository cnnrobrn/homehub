import { describe, expect, it } from 'vitest';

import { queueNames, staticQueueNames } from './registry.js';

describe('queueNames', () => {
  it('builds per-provider sync_full names', () => {
    expect(queueNames.syncFull('gcal')).toBe('sync_full:gcal');
    expect(queueNames.syncFull('monarch')).toBe('sync_full:monarch');
  });

  it('builds per-provider sync_delta names', () => {
    expect(queueNames.syncDelta('gmail')).toBe('sync_delta:gmail');
  });

  it('builds per-target backfill names', () => {
    expect(queueNames.backfill('enrich_event_v2')).toBe('backfill:enrich_event_v2');
  });

  it('exposes the full static queue set', () => {
    expect(staticQueueNames).toContain('enrich_event');
    expect(staticQueueNames).toContain('execute_action');
    expect(staticQueueNames).toContain('pantry_diff');
    // Templated names are intentionally NOT in the static list.
    expect(staticQueueNames).not.toContain('sync_full:gcal');
    // No duplicates.
    const set = new Set(staticQueueNames);
    expect(set.size).toBe(staticQueueNames.length);
  });
});
