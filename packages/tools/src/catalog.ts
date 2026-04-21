/**
 * Tool catalog factory.
 *
 * `createToolCatalog(ctx)` returns:
 *   - `definitions` — raw `ToolDefinition[]` registered for the caller.
 *   - `forModel(scopedSegments?)` — JSON-Schema-ish tool specs the
 *     model sees, filtered to the caller's grants.
 *   - `call(name, rawArgs)` — validates + authorizes + dispatches,
 *     returns a tagged success/failure.
 *
 * The catalog is produced per-context (the handlers close over
 * `ToolContext`). That keeps the surface immutable per turn while
 * letting the agent loop construct a new catalog for each turn.
 */

import { z } from 'zod';

import {
  TOOL_SEGMENTS,
  type OpenAiToolSpec,
  type ToolCallResult,
  type ToolClass,
  type ToolContext,
  type ToolDefinition,
  type ToolSegment,
  type ToolSegmentScope,
  ToolError,
  ToolForbiddenError,
  ToolNotFoundError,
  ToolValidationError,
} from './types.js';

function hasSegmentAccess(
  ctx: ToolContext,
  segments: ToolSegmentScope,
  needWrite: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (segments === 'all') return { ok: true };
  for (const seg of segments) {
    const grant = ctx.grants.find((g) => g.segment === seg);
    if (!grant || grant.access === 'none') {
      return { ok: false, reason: `missing access to segment '${seg}'` };
    }
    if (needWrite && grant.access !== 'write') {
      return { ok: false, reason: `missing write on segment '${seg}'` };
    }
  }
  return { ok: true };
}

function toOpenAiSpec<TIn, TOut>(def: ToolDefinition<TIn, TOut>): OpenAiToolSpec {
  // Zod v4 ships a built-in `z.toJSONSchema`; we pin `unrepresentable: 'any'`
  // so any unserializable refinements degrade gracefully rather than
  // throwing at build time — the model-visible spec is always produced.
  let parameters: Record<string, unknown>;
  try {
    parameters = z.toJSONSchema(def.input, {
      unrepresentable: 'any',
      target: 'draft-2020-12',
    }) as Record<string, unknown>;
  } catch {
    parameters = { type: 'object', additionalProperties: true };
  }
  // Ensure the top-level is an object type — the model providers treat a
  // non-object root as "no args," which breaks tools that carry required
  // fields.
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    parameters = { type: 'object' };
  }
  if (!('type' in parameters)) {
    (parameters as Record<string, unknown>).type = 'object';
  }
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters,
    },
  };
}

export interface ToolCatalog {
  definitions: ReadonlyArray<ToolDefinition<unknown, unknown>>;
  forModel(scopedSegments?: ToolSegment[]): OpenAiToolSpec[];
  call(toolName: string, rawArgs: unknown): Promise<ToolCallResult>;
  definition(toolName: string): ToolDefinition<unknown, unknown> | undefined;
}

export interface CreateCatalogOptions {
  /**
   * Optional injection point — tests pass stub definitions. In
   * production the default tool set comes from `defaultToolSet(ctx)`.
   */
  definitions?: ReadonlyArray<ToolDefinition<unknown, unknown>>;
}

export function createToolCatalogFromDefinitions(
  ctx: ToolContext,
  definitions: ReadonlyArray<ToolDefinition<unknown, unknown>>,
): ToolCatalog {
  const byName = new Map(definitions.map((d) => [d.name, d]));

  function forModel(scopedSegments?: ToolSegment[]): OpenAiToolSpec[] {
    const includeAll = !scopedSegments || scopedSegments.length === 0;
    const visible = definitions.filter((def) => {
      if (def.segments === 'all') return true;
      if (includeAll) return true;
      return def.segments.every((s) => scopedSegments.includes(s));
    });
    return visible.map(toOpenAiSpec);
  }

  async function call(toolName: string, rawArgs: unknown): Promise<ToolCallResult> {
    const def = byName.get(toolName);
    if (!def) {
      const err = new ToolNotFoundError(toolName);
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    // Role gate — applied before segment gates so the error makes sense.
    if (def.requiresRole && def.requiresRole !== ctx.memberRole) {
      // Owners implicitly cover "adult" restrictions.
      const ownerImpliesAdult = def.requiresRole === 'adult' && ctx.memberRole === 'owner';
      if (!ownerImpliesAdult) {
        const err = new ToolForbiddenError(toolName, `requires role '${def.requiresRole}'`);
        return { ok: false, error: { code: err.code, message: err.message } };
      }
    }
    const needWrite = def.class === 'direct-write' || def.class === 'draft-write';
    const seg = hasSegmentAccess(ctx, def.segments, needWrite);
    if (!seg.ok) {
      const err = new ToolForbiddenError(toolName, seg.reason);
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    // Input validation.
    const parsed = def.input.safeParse(rawArgs);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.map(String).join('.') || '(root)',
        message: i.message,
      }));
      const err = new ToolValidationError(toolName, issues);
      return { ok: false, error: { code: err.code, message: err.message, details: issues } };
    }
    const inputValue = parsed.data as unknown;
    try {
      const result = await def.handler(inputValue, ctx);
      // Output validation — the catalog is authoritative; if a handler
      // returns a shape the model shouldn't see, we fail closed rather
      // than stream garbage.
      const outParsed = def.output.safeParse(result);
      if (!outParsed.success) {
        return {
          ok: false,
          error: {
            code: 'tool_output_invalid',
            message: `tool '${toolName}' returned invalid output`,
            details: outParsed.error.issues.map((i) => ({
              path: i.path.map(String).join('.'),
              message: i.message,
            })),
          },
        };
      }
      return { ok: true, result: outParsed.data as unknown, classification: def.class };
    } catch (err) {
      if (err instanceof ToolError) {
        return {
          ok: false,
          error: {
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
          },
        };
      }
      ctx.log.warn('tool handler threw', {
        tool: toolName,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        error: {
          code: 'tool_runtime_error',
          message: err instanceof Error ? err.message : 'handler threw non-Error value',
        },
      };
    }
  }

  return {
    definitions,
    forModel,
    call,
    definition: (name: string) => byName.get(name),
  };
}

/**
 * Classify a catalog's tools for quick introspection (used in tests +
 * observability). Not in the hot path.
 */
export function classifyTools(catalog: ToolCatalog): Record<ToolClass, string[]> {
  const out: Record<ToolClass, string[]> = {
    read: [],
    'draft-write': [],
    'direct-write': [],
  };
  for (const def of catalog.definitions) {
    out[def.class].push(def.name);
  }
  return out;
}

/**
 * Convert a member's `grants` list to the segment subset that read
 * tools may inspect. Segments with `access === 'none'` are dropped.
 */
export function readableSegments(grants: ToolContext['grants']): ToolSegment[] {
  return grants
    .filter((g) => g.access === 'read' || g.access === 'write')
    .map((g) => g.segment)
    .filter((s): s is ToolSegment => (TOOL_SEGMENTS as readonly string[]).includes(s));
}
