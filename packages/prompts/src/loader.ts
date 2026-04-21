/**
 * Prompt markdown loader.
 *
 * Reads a markdown prompt file and parses its conventional sections
 * (`## System Prompt`, `## User Prompt Template`, `## JSON Schema`,
 * `## Version`, `## Few-shot Examples`) into a typed `Prompt` object
 * that the enrichment / consolidation / summary / suggestion workers
 * can render with slot values.
 *
 * Why markdown and not JSON / YAML:
 *   - Prompts are living documents. Humans read the full body during
 *     prompt review; JSON is hostile to that.
 *   - Section headers map cleanly to our internal structure
 *     (system/user/examples) without requiring an escape dance.
 *   - Diffs are readable in GitHub PRs.
 *
 * Why a loader and not `await import(name)`:
 *   - Prompts ship as data, not code. Workers bundle them via the
 *     `files` field in the package's package.json.
 *   - The loader's output is cached per-name; subsequent calls are
 *     O(1) after the first read.
 *
 * Trust boundary: this module reads from the package's own directory
 * tree. Callers cannot pass `../../etc/passwd` — `name` is joined under
 * `PACKAGE_ROOT/<kind>/<name>.md` and `name` is restricted to the
 * `[a-z0-9\-]+` alphabet. Traversal attempts throw.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PromptLoadError, PromptRenderError } from './errors.js';

/** Conservative: lowercase letters, digits, hyphens. Subdirectories supported via slash. */
const ALLOWED_NAME = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

/** Subfolders we look in, in priority order. */
const KIND_DIRS = [
  'extraction',
  'rollup',
  'node-doc',
  'consolidation',
  'reflection',
  'summary',
  'suggestion',
] as const;

/**
 * Typed representation of a prompt file after parsing. Downstream code
 * imports `Prompt` rather than raw strings so new section types can be
 * added without touching every call site.
 */
export interface Prompt {
  /** The raw prompt name (e.g. `'event'` or `'event-classifier'`). */
  name: string;
  /** Body of the `## System Prompt` section. */
  systemPrompt: string;
  /** Body of the `## User Prompt Template` section. May contain `{{slot}}` tokens. */
  userPromptTemplate: string;
  /**
   * Declarative name of the schema the prompt's response validates
   * against. The worker looks this up in `./schemas.ts`. Optional — a
   * prompt that doesn't need structured output leaves it undefined.
   */
  schemaName?: string;
  /** Body of the `## Version` section — typically a dated tag. */
  version: string;
  /** Body of the `## Few-shot Examples` section. May be empty. */
  examples: string;
}

/**
 * Rendered (slot-substituted) prompt, ready to pass to `generate()`.
 */
export interface RenderedPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Prompt file lookup cache. We don't expect prompt files to change at
 * runtime, and reading them on every model call would be wasteful.
 */
const CACHE = new Map<string, Prompt>();

function packageRoot(): string {
  // This module lives at `<root>/src/loader.ts` in source and
  // `<root>/dist/loader.js` at runtime. The prompt files live alongside
  // source as data (`<root>/extraction/*.md`, etc.) — not copied into
  // `dist`. Walk up two directories from the current module and search
  // relative to that.
  const here = dirname(fileURLToPath(import.meta.url));
  // If we're in `dist/`, the prompt files are at `../extraction`. If
  // we're in `src/`, the prompt files are at `../extraction`. Both
  // collapse to the same parent.
  return join(here, '..');
}

function resolvePromptPath(name: string): string {
  if (!ALLOWED_NAME.test(name)) {
    throw new PromptLoadError(
      `invalid prompt name: ${JSON.stringify(name)}; expected [a-z0-9-]+ optionally containing '/'`,
      name,
    );
  }

  // If the caller passed an explicit subdir (`extraction/event`), use
  // that directly; otherwise search the known kind directories.
  const root = packageRoot();
  if (name.includes('/')) {
    return join(root, `${name}.md`);
  }
  for (const kind of KIND_DIRS) {
    const candidate = join(root, kind, `${name}.md`);
    try {
      // Reading and throwing if missing is faster than a two-step
      // existsSync → readFileSync.
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // Keep searching.
    }
  }
  throw new PromptLoadError(
    `prompt not found under any known kind dir (${KIND_DIRS.join(', ')}): ${name}`,
    name,
  );
}

/**
 * Parse a markdown document into section bodies keyed by the heading
 * text. We use `## Heading` (level 2) as the delimiter because every
 * top-level prompt file starts with a single `# Title` and uses level-2
 * headings for its sections. Nested `###` headings inside a section
 * body are preserved verbatim.
 *
 * The parser is intentionally tiny: it splits on lines beginning with
 * `## `, trims each chunk, and returns a `Map<headingText, body>`.
 */
function parseMarkdownSections(md: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = md.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (currentHeading !== null) {
      sections.set(currentHeading, buffer.join('\n').trim());
    }
  };

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match && !line.startsWith('### ')) {
      flush();
      currentHeading = match[1]!.trim();
      buffer = [];
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
    // Lines before the first `## ` heading are dropped — they belong
    // to the file title / preamble and are not part of the runtime
    // contract.
  }
  flush();
  return sections;
}

/**
 * Pull a section body by case-insensitive heading match. `aliases`
 * supports minor drift in author conventions (`## JSON Schema` vs
 * `## Schema`) without making the loader fragile.
 */
function section(sections: Map<string, string>, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    for (const [heading, body] of sections) {
      if (heading.toLowerCase() === alias.toLowerCase()) {
        return body;
      }
    }
  }
  return undefined;
}

/**
 * Load and parse a prompt by name. Results are cached in-process.
 */
export function loadPrompt(name: string): Prompt {
  const cached = CACHE.get(name);
  if (cached) return cached;

  const path = resolvePromptPath(name);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new PromptLoadError(`failed to read prompt file: ${path}`, name, { cause: err });
  }

  const sections = parseMarkdownSections(raw);

  const systemPrompt = section(sections, ['System Prompt', 'System']);
  const userPromptTemplate = section(sections, [
    'User Prompt Template',
    'User Prompt',
    'User Template',
  ]);
  const version = section(sections, ['Version']);

  if (!systemPrompt) {
    throw new PromptLoadError(
      `prompt file missing required '## System Prompt' section: ${path}`,
      name,
    );
  }
  if (!userPromptTemplate) {
    throw new PromptLoadError(
      `prompt file missing required '## User Prompt Template' section: ${path}`,
      name,
    );
  }
  if (!version) {
    throw new PromptLoadError(`prompt file missing required '## Version' section: ${path}`, name);
  }

  const examples = section(sections, ['Few-shot Examples', 'Examples']) ?? '';
  const schemaName = section(sections, ['Schema Name', 'Schema']);

  // Strip code-fence wrappers from the system / user template bodies if
  // present. Authors commonly wrap templates in ``` blocks for
  // readability in rendered markdown; the runtime only wants the bare
  // text. We strip *only when* the entire body is wrapped in a single
  // fenced block, so partial fences (which do carry semantic value in
  // few-shot examples) are preserved.
  const stripFence = (body: string): string => {
    const m = /^```(?:\w+)?\n([\s\S]*?)\n```\s*$/.exec(body.trim());
    return m ? m[1]!.trim() : body;
  };

  const prompt: Prompt = {
    name,
    systemPrompt: stripFence(systemPrompt),
    userPromptTemplate: stripFence(userPromptTemplate),
    ...(schemaName ? { schemaName } : {}),
    version,
    examples,
  };
  CACHE.set(name, prompt);
  return prompt;
}

/**
 * Substitute `{{slot}}` tokens in the system and user templates.
 *
 * `vars` is a flat `key → string` map. Values are substituted
 * verbatim; the loader does not attempt JSON-escape them. Callers are
 * responsible for ensuring the substitution targets make sense for the
 * slot position (e.g. a json-stringified attendees list for a slot that
 * expects JSON).
 *
 * Unfilled slots throw `PromptRenderError`. This is intentional: a
 * silent `{{attendees}}` in the user prompt is a correctness bug.
 */
export function renderPrompt(prompt: Prompt, vars: Record<string, string>): RenderedPrompt {
  const missing: string[] = [];

  const substitute = (template: string): string =>
    template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
      if (Object.prototype.hasOwnProperty.call(vars, key)) {
        return vars[key]!;
      }
      if (!missing.includes(key)) missing.push(key);
      return _;
    });

  const systemPrompt = substitute(prompt.systemPrompt);
  const userPrompt = substitute(prompt.userPromptTemplate);

  if (missing.length > 0) {
    throw new PromptRenderError(
      `renderPrompt: ${missing.length} unfilled slot(s) in ${prompt.name}: ${missing.join(', ')}`,
      prompt.name,
      missing,
    );
  }

  return { systemPrompt, userPrompt };
}

/**
 * Clear the prompt cache. Exposed for tests — production code does not
 * call this.
 */
export function _clearPromptCache(): void {
  CACHE.clear();
}
