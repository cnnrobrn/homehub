/**
 * `host_back` generator.
 *
 * Spec: `specs/06-segments/social/suggestions-coordination.md` — "Host
 * back when a reciprocity imbalance is detected."
 *
 * Input: the set of `reciprocity_imbalance` signals (caller pre-
 * computes using `packages/alerts/src/social/reciprocity-imbalance`) +
 * a list of `freeWindows` (90-day horizon weekend slots) from the
 * household's calendar.
 *
 * Output: one suggestion per imbalanced person, carrying the top 3
 * candidate windows in `preview.candidate_windows`.
 *
 * Dedupe key: `host_back:${personNodeId}:${quarter}`.
 */

import { type RationaleWriter, type SuggestionEmission } from '../types.js';

export interface ReciprocitySignal {
  personNodeId: string;
  canonicalName: string;
  weHosted: number;
  hostedUs: number;
}

export interface FreeWindow {
  /** ISO 8601 start. */
  startsAt: string;
  /** ISO 8601 end. */
  endsAt: string;
  /** Human label: "Sat evening", "Fri brunch", etc. */
  label: string;
}

export interface HostBackInput {
  householdId: string;
  imbalanced: ReadonlyArray<ReciprocitySignal>;
  freeWindows: ReadonlyArray<FreeWindow>;
  now: Date;
  maxSuggestions?: number;
}

export async function generateHostBack(
  input: HostBackInput,
  writer?: RationaleWriter,
): Promise<SuggestionEmission[]> {
  const max = input.maxSuggestions ?? 5;
  const quarter = `${input.now.getUTCFullYear()}Q${Math.floor(input.now.getUTCMonth() / 3) + 1}`;
  const windows = [...input.freeWindows]
    .filter((w) => Date.parse(w.startsAt) > input.now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 3);

  const out: SuggestionEmission[] = [];
  const sorted = [...input.imbalanced]
    .sort((a, b) => b.weHosted - b.hostedUs - (a.weHosted - a.hostedUs))
    .slice(0, max);

  for (const signal of sorted) {
    const fallback = renderFallback(signal, windows);
    const rationale = writer
      ? await writer({
          kind: 'host_back',
          candidate: {
            person_node_id: signal.personNodeId,
            canonical_name: signal.canonicalName,
            we_hosted: signal.weHosted,
            hosted_us: signal.hostedUs,
            windows,
          },
          fallback,
        })
      : fallback;

    out.push({
      segment: 'social',
      kind: 'host_back',
      title: `Host ${signal.canonicalName} — your reciprocity is lopsided`,
      rationale,
      preview: {
        person_node_id: signal.personNodeId,
        canonical_name: signal.canonicalName,
        we_hosted: signal.weHosted,
        hosted_us: signal.hostedUs,
        candidate_windows: windows,
        dedupe_key: `host_back:${signal.personNodeId}:${quarter}`,
      },
      dedupeKey: `host_back:${signal.personNodeId}:${quarter}`,
    });
  }

  return out;
}

function renderFallback(signal: ReciprocitySignal, windows: ReadonlyArray<FreeWindow>): string {
  const lines: string[] = [];
  lines.push(
    `In the last six months you hosted ${signal.canonicalName} ${signal.weHosted}× and they hosted you ${signal.hostedUs}×. A reciprocal invite keeps the relationship balanced.`,
  );
  if (windows.length > 0) {
    lines.push('Free windows to propose:');
    for (const w of windows) {
      lines.push(`- ${w.label} (${w.startsAt} → ${w.endsAt})`);
    }
  }
  return lines.join('\n');
}
