import { describe, expect, it } from 'vitest';

import { generateHostBack } from './host-back.js';

describe('generateHostBack', () => {
  const now = new Date('2026-04-20T00:00:00Z');
  const windows = [
    {
      startsAt: '2026-04-25T18:00:00Z',
      endsAt: '2026-04-25T22:00:00Z',
      label: 'Sat evening',
    },
    {
      startsAt: '2026-05-02T12:00:00Z',
      endsAt: '2026-05-02T15:00:00Z',
      label: 'Sat brunch',
    },
  ];

  it('emits one suggestion per imbalanced pair with proposed windows', async () => {
    const out = await generateHostBack({
      householdId: 'h-1',
      imbalanced: [
        { personNodeId: 'p-1', canonicalName: 'Garcias', weHosted: 3, hostedUs: 1 },
        { personNodeId: 'p-2', canonicalName: 'Lees', weHosted: 2, hostedUs: 0 },
      ],
      freeWindows: windows,
      now,
    });
    expect(out).toHaveLength(2);
    // Sorted by greatest gap first: Garcias gap=2, Lees gap=2 (tie) — stable.
    expect(out[0]!.kind).toBe('host_back');
    const preview = out[0]!.preview;
    expect(preview.candidate_windows).toHaveLength(2);
  });

  it('uses the rationale writer when provided', async () => {
    const out = await generateHostBack(
      {
        householdId: 'h-1',
        imbalanced: [{ personNodeId: 'p-1', canonicalName: 'Garcias', weHosted: 3, hostedUs: 1 }],
        freeWindows: windows,
        now,
      },
      async ({ fallback }) => `CUSTOM: ${fallback.slice(0, 40)}`,
    );
    expect(out[0]!.rationale.startsWith('CUSTOM:')).toBe(true);
  });

  it('caps at maxSuggestions', async () => {
    const out = await generateHostBack({
      householdId: 'h-1',
      imbalanced: Array.from({ length: 8 }, (_, i) => ({
        personNodeId: `p-${i}`,
        canonicalName: `Fam-${i}`,
        weHosted: 5,
        hostedUs: 0,
      })),
      freeWindows: windows,
      now,
      maxSuggestions: 3,
    });
    expect(out).toHaveLength(3);
  });
});
