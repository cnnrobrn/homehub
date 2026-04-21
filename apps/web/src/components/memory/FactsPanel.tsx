/**
 * Panel of facts for a node's detail tab.
 *
 * Server Component shell that resolves the object-label per fact
 * (when the object is another node, we want to render its
 * canonical name) and delegates each row render to the `FactRow`
 * client island for the affordances.
 */

import { FactRow, type EvidenceEntry } from './FactRow';

import type { FactRow as FactRowT, NodeRow } from '@/lib/memory/query';

export interface FactsPanelProps {
  subjectLabel: string;
  facts: FactRowT[];
  /** Lookup: nodeId → canonical_name for rendering object references. */
  nodeLookup: Map<string, NodeRow>;
}

export function FactsPanel({ subjectLabel, facts, nodeLookup }: FactsPanelProps) {
  if (facts.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-4 text-sm text-fg-muted">
        No facts recorded for this node yet.
      </p>
    );
  }

  // Live facts first (no valid_to), then historical.
  const sorted = [...facts].sort((a, b) => {
    if ((a.valid_to === null) !== (b.valid_to === null)) return a.valid_to === null ? -1 : 1;
    return Date.parse(b.recorded_at) - Date.parse(a.recorded_at);
  });

  return (
    <ul
      className="divide-y divide-border rounded-md border border-border bg-surface"
      aria-label="Facts"
    >
      {sorted.map((fact) => (
        <FactRow
          key={fact.id}
          subjectLabel={subjectLabel}
          fact={{
            id: fact.id,
            predicate: fact.predicate,
            object_value: fact.object_value,
            object_node_id: fact.object_node_id,
            object_label: fact.object_node_id
              ? (nodeLookup.get(fact.object_node_id)?.canonical_name ?? null)
              : null,
            confidence: fact.confidence,
            valid_from: fact.valid_from,
            valid_to: fact.valid_to,
            source: fact.source,
            conflict_status: fact.conflict_status,
            reinforcement_count: fact.reinforcement_count,
            evidence: Array.isArray(fact.evidence) ? (fact.evidence as EvidenceEntry[]) : [],
            superseded_at: fact.superseded_at,
            superseded_by: fact.superseded_by,
          }}
        />
      ))}
    </ul>
  );
}
