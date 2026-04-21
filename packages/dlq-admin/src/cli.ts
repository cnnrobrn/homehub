#!/usr/bin/env node
/**
 * `homehub-dlq` — CLI for operators triaging the dead-letter queue.
 *
 * Usage:
 *   pnpm --filter @homehub/dlq-admin dlq list [--queue NAME] [--household UUID] [--limit N]
 *   pnpm --filter @homehub/dlq-admin dlq replay <id>
 *   pnpm --filter @homehub/dlq-admin dlq purge  <id>
 *
 * Env required (service role — this is an operator-only tool):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Design notes
 * - Output is plain text (`queue`, `received_at`, `error` summary, `id`).
 *   JSON mode could be added later; keep the CLI small for now.
 * - The CLI never hides errors — primitives throw, the process exits
 *   with code 1. Operators running this under a ticket want the stack
 *   trace.
 */

import { loadEnv } from '@homehub/shared';
import {
  createQueueClient,
  createServiceClient,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { listDeadLetters, purgeDeadLetter, replayDeadLetter } from './primitives.js';

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) continue;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(token);
    }
  }
  return { command: command ?? '', positional, flags };
}

function usage(): string {
  return [
    'homehub-dlq — triage the dead-letter queue',
    '',
    'Commands:',
    '  list    [--queue NAME] [--household UUID] [--limit N]   List DLQ entries',
    '  replay  <id>                                             Re-enqueue a DLQ entry',
    '  purge   <id>                                             Delete a DLQ entry',
    '',
    'Env:',
    '  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are required.',
  ].join('\n');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help') {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const env = loadEnv(workerRuntimeEnvSchema);
  const supabase = createServiceClient(env);

  switch (parsed.command) {
    case 'list': {
      const args: Parameters<typeof listDeadLetters>[1] = {};
      if (parsed.flags.queue) args.queue = parsed.flags.queue;
      if (parsed.flags.household) args.householdId = parsed.flags.household;
      if (parsed.flags.limit) args.limit = Number.parseInt(parsed.flags.limit, 10);
      const entries = await listDeadLetters(supabase, args);
      if (entries.length === 0) {
        process.stdout.write('no dead-letter entries match the filter\n');
        return 0;
      }
      const rows = entries.map((e) => [
        e.receivedAt,
        e.queue.padEnd(24, ' '),
        truncate(e.error, 80).padEnd(80, ' '),
        e.id,
      ]);
      for (const r of rows) {
        process.stdout.write(`${r.join('  ')}\n`);
      }
      return 0;
    }
    case 'replay': {
      const id = parsed.positional[0];
      if (!id) {
        process.stderr.write('replay requires a dead-letter id\n');
        return 2;
      }
      const queues = createQueueClient(supabase);
      const result = await replayDeadLetter(supabase, queues, id);
      if (result.enqueued) {
        process.stdout.write(`replayed ${id}\n`);
        return 0;
      }
      process.stderr.write(`replay failed: ${result.reason ?? 'unknown'}\n`);
      return 1;
    }
    case 'purge': {
      const id = parsed.positional[0];
      if (!id) {
        process.stderr.write('purge requires a dead-letter id\n');
        return 2;
      }
      await purgeDeadLetter(supabase, id);
      process.stdout.write(`purged ${id}\n`);
      return 0;
    }
    default:
      process.stderr.write(`unknown command: ${parsed.command}\n${usage()}\n`);
      return 2;
  }
}

const exitCode = await main(process.argv.slice(2));
process.exit(exitCode);
