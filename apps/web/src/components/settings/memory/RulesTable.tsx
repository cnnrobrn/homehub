/**
 * Server Component shell for the household-rules table.
 *
 * Per-row Edit / Archive / Delete live in `<RuleRowActions>` — a client
 * island that only renders when `rule.isMine` is true, per the M3-A RLS
 * (members can only mutate their own rules). The table structure itself
 * is server-rendered so the initial paint is fast and stable.
 */

import { formatDistanceToNowIso } from './formatDistanceToNowIso';
import { RuleRowActions } from './RuleRowActions';

import type { HouseholdRuleSummary } from '@/app/actions/memory';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface RulesTableProps {
  rules: HouseholdRuleSummary[];
}

export function RulesTable({ rules }: RulesTableProps) {
  if (rules.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg p-4 text-sm text-fg-muted">
        No household rules yet. Add one below to capture a preference the assistant should honor.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Description</TableHead>
          <TableHead className="w-40">Author</TableHead>
          <TableHead className="w-24">Active</TableHead>
          <TableHead className="w-32">Created</TableHead>
          <TableHead className="w-16 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.id}>
            <TableCell className="max-w-xl align-top">
              <div className="flex flex-col gap-1">
                <span className="whitespace-pre-wrap text-sm text-fg">{rule.description}</span>
                {Object.keys(rule.predicateDsl).length > 0 ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-fg-muted hover:text-fg">
                      Show predicate DSL
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-sm bg-bg p-2 text-[11px] text-fg-muted">
                      {JSON.stringify(rule.predicateDsl, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="align-top text-fg-muted">
              {rule.authorDisplayName ?? 'Unknown'}
              {rule.isMine ? <span className="ml-1 text-xs">(you)</span> : null}
            </TableCell>
            <TableCell className="align-top">
              <span
                className={
                  rule.active
                    ? 'inline-block rounded-md bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent'
                    : 'inline-block rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted'
                }
              >
                {rule.active ? 'Active' : 'Archived'}
              </span>
            </TableCell>
            <TableCell className="align-top text-fg-muted">
              {formatDistanceToNowIso(rule.createdAt)}
            </TableCell>
            <TableCell className="align-top text-right">
              {rule.isMine ? (
                <RuleRowActions
                  ruleId={rule.id}
                  description={rule.description}
                  active={rule.active}
                />
              ) : (
                <span className="text-xs text-fg-muted">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
