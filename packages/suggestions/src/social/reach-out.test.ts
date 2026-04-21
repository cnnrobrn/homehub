import { describe, expect, it } from 'vitest';

import { generateReachOut } from './reach-out.js';

describe('generateReachOut', () => {
  const now = new Date('2026-04-20T00:00:00Z');

  it('emits one suggestion per absent person', async () => {
    const out = await generateReachOut({
      householdId: 'h-1',
      absent: [
        {
          personNodeId: 'p-1',
          canonicalName: 'Mom',
          lastSeenAt: '2026-02-01T00:00:00Z',
          daysSince: 78,
        },
        {
          personNodeId: 'p-2',
          canonicalName: 'Dad',
          lastSeenAt: '2026-01-15T00:00:00Z',
          daysSince: 95,
        },
      ],
      now,
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe('reach_out');
    expect(out[0]!.dedupeKey).toContain('reach_out:');
    // Higher daysSince sorts first.
    expect(out[0]!.preview.person_node_id).toBe('p-2');
  });

  it('caps at maxSuggestions', async () => {
    const out = await generateReachOut({
      householdId: 'h-1',
      absent: Array.from({ length: 10 }, (_, i) => ({
        personNodeId: `p-${i}`,
        canonicalName: `P${i}`,
        lastSeenAt: null,
        daysSince: 100 - i,
      })),
      now,
      maxSuggestions: 3,
    });
    expect(out).toHaveLength(3);
  });

  it('uses the rationale writer when provided', async () => {
    const out = await generateReachOut(
      {
        householdId: 'h-1',
        absent: [{ personNodeId: 'p-1', canonicalName: 'Mom', lastSeenAt: null, daysSince: 61 }],
        now,
      },
      async ({ fallback }) => `POLISHED: ${fallback}`,
    );
    expect(out[0]!.rationale.startsWith('POLISHED:')).toBe(true);
  });
});
