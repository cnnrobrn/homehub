/**
 * `<DecisionItem />` — single decision card on the `/suggestions`
 * (Decisions) page.
 *
 * Wraps the V2 Indie `DecisionCard` primitive with the mechanics of the
 * existing suggestion inbox:
 *
 *  - Approve / Reject driven by `<SuggestionApprovalPill />` (the pill
 *    owns quorum display + server-action calls; we only restyle its
 *    surroundings so its mechanics and tests stay intact).
 *  - Evidence drawer surfaced as a quiet third action ("look closer").
 *  - Segment mapped from the suggestion row, with `system` falling back
 *    to the `social` neutral-blue tone that LookCards use elsewhere.
 *
 * Intentionally a Client Component so the pill's transitions + drawer
 * state stay colocated.
 */

'use client';

import type { SuggestionRowView } from '@/lib/suggestions';

import { DecisionCard, type SegmentId } from '@/components/design-system';
import { SuggestionApprovalPill } from '@/components/suggestions/SuggestionApprovalPill';
import { SuggestionEvidenceDrawer } from '@/components/suggestions/SuggestionEvidenceDrawer';


export interface DecisionItemProps {
  suggestion: SuggestionRowView;
}

function isAppSegment(s: string): s is SegmentId {
  return s === 'financial' || s === 'food' || s === 'fun' || s === 'social';
}

/**
 * Short lowercase meta shown next to the segment dot. Mirrors the
 * design's "for Priya" / "for your budget" voice. Kind beats segment as
 * a more specific hint where it's available.
 */
function metaFor(s: SuggestionRowView): string {
  switch (s.kind) {
    case 'cancel_subscription':
      return 'for your budget';
    case 'propose_transfer':
    case 'settle_shared_expense':
      return 'for the books';
    case 'reach_out':
      return 'for someone';
    case 'gift_idea':
      return 'a small gift';
    case 'host_back':
      return 'hosting back';
    case 'draft_message':
      return 'a note to send';
    case 'outing_idea':
    case 'propose_add_to_calendar':
    case 'add_to_calendar':
      return 'for the week';
    case 'trip_prep':
      return 'for a trip';
    case 'propose_grocery_order':
    case 'grocery_order':
      return 'for the kitchen';
    case 'draft_meal_plan':
    case 'meal_swap':
    case 'new_dish':
    case 'propose_book_reservation':
      return 'for tonight';
    default:
      switch (s.segment) {
        case 'financial':
          return 'for your budget';
        case 'food':
          return 'for the kitchen';
        case 'fun':
          return 'for the week';
        case 'social':
          return 'for someone';
        default:
          return 'for the house';
      }
  }
}

/**
 * Compute a calm "waits until …" expiry label. The DB doesn't carry a
 * per-suggestion expiry yet; we approximate by showing the weekday a
 * suggestion was drafted, so members can feel the passage without a
 * ticking clock.
 */
function expiresLabel(createdAt: string): string | null {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
  return `drafted ${day}`;
}

/**
 * Pull a human-readable draft preview from the suggestion payload. We
 * walk a list of well-known fields before falling back to the rationale
 * so the preview callout is rarely empty. Returning `null` lets the
 * caller fall back to the rationale line.
 */
function draftPreview(s: SuggestionRowView): string | null {
  const p = s.preview;
  const keys = [
    'draft_text',
    'draft',
    'message',
    'body',
    'summary',
    'plan',
    'note',
    'description',
  ] as const;
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

export function DecisionItem({ suggestion }: DecisionItemProps) {
  const seg: SegmentId = isAppSegment(suggestion.segment) ? suggestion.segment : 'social';
  const meta = metaFor(suggestion);
  const expires = expiresLabel(suggestion.createdAt);
  const preview = draftPreview(suggestion) ?? suggestion.rationale;
  // "why" only makes sense when the preview isn't itself the rationale —
  // otherwise we'd repeat ourselves and break the quiet rhythm.
  const why = preview === suggestion.rationale ? null : suggestion.rationale;

  const rawEvidence = suggestion.preview.evidence;
  const evidence =
    Array.isArray(rawEvidence) && rawEvidence.every((e) => typeof e === 'object' && e !== null)
      ? (rawEvidence as Array<Record<string, unknown>>)
      : [];
  const modelPromptId =
    typeof suggestion.preview.model_prompt_id === 'string'
      ? suggestion.preview.model_prompt_id
      : null;
  const modelVersion =
    typeof suggestion.preview.model_version === 'string'
      ? (suggestion.preview.model_version as string)
      : null;

  return (
    <DecisionCard
      segment={seg}
      meta={meta}
      expires={expires}
      title={suggestion.title}
      preview={preview}
      why={why}
      actions={
        <div className="flex w-full flex-wrap items-center gap-2">
          <SuggestionApprovalPill
            suggestionId={suggestion.id}
            status={suggestion.status}
            requiresQuorum={suggestion.requiresQuorum}
            approvers={suggestion.approvers}
            approveLabel="send it"
            rejectLabel="not yet"
            size="sm"
          />
          <div className="ml-auto">
            <SuggestionEvidenceDrawer
              suggestionId={suggestion.id}
              suggestionTitle={suggestion.title}
              alertContext={null}
              evidence={evidence}
              modelPromptId={modelPromptId}
              modelVersion={modelVersion}
              label="look closer"
            />
          </div>
        </div>
      }
    />
  );
}
