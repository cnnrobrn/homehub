/**
 * Warning pip for facts with `conflict_status != 'none'`.
 *
 * Server Component. Renders an icon + label so color isn't the
 * only signal (per accessibility: conflict is encoded by icon +
 * label + border, not just the palette).
 */

import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

export interface ConflictBadgeProps {
  status: string;
}

export function ConflictBadge({ status }: ConflictBadgeProps) {
  if (status === 'none') return null;
  const label = status === 'parked_conflict' ? 'Parked conflict' : 'Unresolved';
  return (
    <Badge
      variant="warn"
      className="inline-flex items-center gap-1"
      role="status"
      aria-label={`Conflict: ${label}`}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}
