/**
 * `scripts/lint-log-fields.ts` — flag direct `console.log` / `console.error`
 * in worker source.
 *
 * We require workers to log through the structured logger
 * (`@homehub/worker-runtime createLogger`) so every line carries the
 * fields the observability spec requires. Direct `console.*` calls land
 * in Railway stdout without those fields, which breaks correlation.
 *
 * The script walks `apps/workers/**` (and the worker-runtime package
 * itself, whose `*.test.ts` and startup bootstrap areas are allowed —
 * see the allowlist below). It prints every `console.*` hit it finds
 * and exits non-zero by default, or zero when run with `--warn` so CI
 * can treat it as advisory while workers migrate.
 *
 * Usage:
 *   tsx scripts/lint-log-fields.ts          # strict, non-zero on hits
 *   tsx scripts/lint-log-fields.ts --warn   # report-only, always zero
 *
 * Allowlist: the allowed call sites are the ones that sit below the
 * logger itself (e.g. `runWorker()` inside `packages/worker-runtime`
 * uses `console.*` intentionally because the logger may be shutting
 * down). Extend the list deliberately with a comment.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);

const ROOTS = [
  path.join(REPO_ROOT, 'apps/workers'),
  path.join(REPO_ROOT, 'packages/worker-runtime/src'),
];

/**
 * Files and directories where `console.*` is allowed. Be specific —
 * prefer a file-level entry over a whole-directory allow.
 */
const ALLOWLIST = new Set<string>([
  // Worker lifecycle uses console at the outer boundary because the
  // structured logger may already be tearing down during shutdown.
  path.join(REPO_ROOT, 'packages/worker-runtime/src/lifecycle/run.ts'),
  // Tracing + sentry init write to console before the logger exists.
  path.join(REPO_ROOT, 'packages/worker-runtime/src/otel/tracing.ts'),
  // Test files can use console freely.
]);

const TEST_GLOB = /\.(test|spec)\.ts$/;
const CONSOLE_PATTERN = /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/g;

interface Hit {
  file: string;
  line: number;
  excerpt: string;
}

async function walk(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip build / cache / node_modules.
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') {
        continue;
      }
      results.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

async function main(): Promise<number> {
  const files = (await Promise.all(ROOTS.map(walk))).flat();
  const hits: Hit[] = [];

  for (const file of files) {
    if (TEST_GLOB.test(file)) continue;
    if (ALLOWLIST.has(file)) continue;
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      CONSOLE_PATTERN.lastIndex = 0;
      if (CONSOLE_PATTERN.test(line)) {
        hits.push({ file, line: i + 1, excerpt: line.trim() });
      }
    }
  }

  const warnOnly = process.argv.includes('--warn');

  if (hits.length === 0) {
    process.stdout.write('log-field-lint: clean\n');
    return 0;
  }

  const stream = warnOnly ? process.stdout : process.stderr;
  stream.write(`log-field-lint: ${hits.length} direct console.* call(s) detected\n`);
  for (const h of hits) {
    stream.write(`  ${path.relative(REPO_ROOT, h.file)}:${h.line}  ${h.excerpt}\n`);
  }
  stream.write(
    '\nPrefer the structured logger from @homehub/worker-runtime (createLogger).\n' +
      'If this call site is intentional, add it to ALLOWLIST in scripts/lint-log-fields.ts.\n',
  );
  return warnOnly ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `log-field-lint: fatal error ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
