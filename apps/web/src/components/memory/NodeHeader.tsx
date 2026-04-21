/**
 * Node detail header.
 *
 * Server Component with a small Client island (`PinButton`) for
 * the pin toggle. Owner-only actions (Merge, Delete) are rendered
 * by a sibling dropdown (`NodeOwnerMenu`) in the page; this
 * component focuses on identity + needs_review + pin state.
 */

import { NODE_TYPE_LABEL } from './nodeTypeStyles';
import { PinButton } from './PinButton';

import type { NodeRow } from '@/lib/memory/query';
import type { NodeType } from '@homehub/shared';

import { Badge } from '@/components/ui/badge';

export interface NodeHeaderProps {
  node: NodeRow;
  pinned: boolean;
}

export function NodeHeader({ node, pinned }: NodeHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{node.canonical_name}</h1>
          <Badge variant="outline">{NODE_TYPE_LABEL[node.type as NodeType] ?? node.type}</Badge>
          {node.needs_review ? <Badge variant="warn">Needs review</Badge> : null}
        </div>
        <p className="text-sm text-fg-muted">
          Last updated{' '}
          {new Date(node.updated_at).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      </div>
      <PinButton nodeId={node.id} initialPinned={pinned} />
    </header>
  );
}
