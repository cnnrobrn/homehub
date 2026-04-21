/**
 * Dashboard segment tile. M1 renders all four as disabled placeholders —
 * every segment UI lands in M2+ when the provider connectors + summary
 * workers come online (see `specs/06-segments/`).
 *
 * Kept as a Server Component because the tile has no local state yet.
 * When the real dashboards arrive, a segment-specific summary should be
 * threaded in as a prop from the page.
 */

import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SegmentCardProps {
  label: string;
  description: string;
  icon: ReactNode;
}

export function SegmentCard({ label, description, icon }: SegmentCardProps) {
  return (
    <Card
      role="group"
      aria-label={`${label} segment (coming soon)`}
      className="flex h-full flex-col gap-2 opacity-70"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-fg-muted">{icon}</span>
          <CardTitle>{label}</CardTitle>
        </div>
        <Badge variant="outline" aria-label="Status: coming in M2 or later">
          Soon
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-fg-muted">{description}</p>
      </CardContent>
    </Card>
  );
}
