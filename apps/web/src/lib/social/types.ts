/**
 * Shared types for the social segment web helpers.
 */

export interface SegmentGrant {
  segment: string;
  access: 'none' | 'read' | 'write';
}

export function hasSocialRead(grants: readonly SegmentGrant[]): boolean {
  return grants.some(
    (g) => g.segment === 'social' && (g.access === 'read' || g.access === 'write'),
  );
}

export function hasSocialWrite(grants: readonly SegmentGrant[]): boolean {
  return grants.some((g) => g.segment === 'social' && g.access === 'write');
}

export interface PersonRow {
  id: string;
  householdId: string;
  canonicalName: string;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  relationship: string | null;
}

export interface GroupRow {
  id: string;
  householdId: string;
  canonicalName: string;
  memberNodeIds: string[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface SocialAlertRow {
  id: string;
  householdId: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  generatedAt: string;
  dismissedAt: string | null;
  alertKind: string | null;
  alertDedupeKey: string | null;
  context: Record<string, unknown>;
}

export interface SocialSuggestionRow {
  id: string;
  householdId: string;
  kind: string;
  title: string;
  rationale: string;
  status: string;
  createdAt: string;
  preview: Record<string, unknown>;
}

export interface SocialSummaryRow {
  id: string;
  householdId: string;
  period: string;
  coveredStart: string;
  coveredEnd: string;
  generatedAt: string;
  model: string;
  bodyMd: string;
}
