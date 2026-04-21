/**
 * Core types for the foreground-agent tool catalog.
 *
 * The catalog is a framework-agnostic shared surface: the foreground
 * agent loop calls into it from its serial tool-dispatch stage, and
 * (later) `apps/mcp/homehub-core` will converge on the same shape so
 * MCP clients and the web chat share one definition for every tool.
 *
 * Shape, in order of importance:
 *   - `ToolDefinition` — one tool. Has a Zod input/output schema, a
 *     classification (read / draft-write / direct-write), a segment
 *     allowlist (or `'all'`), an optional role gate, and a handler.
 *   - `ToolContext` — what every handler has access to at call time:
 *     the caller's household, member, grants, service client, the
 *     `query_memory` client, and a logger.
 *   - `OpenAiToolSpec` — JSON-Schema-flavored shape we hand to the
 *     model as its tool list. The model emits tool calls with names
 *     matching the catalog's keys; the loop round-trips via
 *     `call(name, rawArgs)`.
 */

import type { QueryMemoryClient } from '@homehub/query-memory';
import type { HouseholdId, MemberId } from '@homehub/shared';
import type { Logger, ServiceSupabaseClient } from '@homehub/worker-runtime';
import type { z } from 'zod';

export const TOOL_CLASSES = ['read', 'draft-write', 'direct-write'] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

export const TOOL_SEGMENTS = ['financial', 'food', 'fun', 'social', 'system'] as const;
export type ToolSegment = (typeof TOOL_SEGMENTS)[number];

export type ToolSegmentScope = ToolSegment[] | 'all';

export type MemberRole = 'owner' | 'adult' | 'child' | 'guest' | 'non_connected';

export interface ToolGrant {
  segment: ToolSegment;
  access: 'none' | 'read' | 'write';
}

export interface ToolContext {
  householdId: HouseholdId;
  memberId: MemberId;
  memberRole: MemberRole;
  grants: ToolGrant[];
  supabase: ServiceSupabaseClient;
  queryMemory: QueryMemoryClient;
  log: Logger;
  /** Optional override of "now" for deterministic tests. */
  now?: () => Date;
}

export interface ToolDefinition<TInput, TOutput> {
  /** Unique, snake-cased catalog id. Also the name the model sees. */
  name: string;
  /** Model-visible description. Keep short and action-oriented. */
  description: string;
  class: ToolClass;
  input: z.ZodType<TInput>;
  output: z.ZodType<TOutput>;
  /**
   * Segments this tool touches. `'all'` means the tool is always
   * available (e.g. `query_memory`, `get_household_members`). An array
   * means the member must hold at least `'read'` (for read tools) or
   * `'write'` (for writes) on *every* listed segment.
   */
  segments: ToolSegmentScope;
  /** Optional role gate (e.g. `'owner'` for destructive tools). */
  requiresRole?: MemberRole;
  handler: (args: TInput, ctx: ToolContext) => Promise<TOutput>;
}

/**
 * Subset of the OpenAI / OpenRouter `function`-style tool spec the
 * catalog hands to the model. Generating this from the same Zod
 * schemas used at runtime means description-for-model and validation
 * can never drift.
 */
export interface OpenAiToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Structured error types a handler may raise. */
export class ToolError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
  }
}

export class ToolNotFoundError extends ToolError {
  constructor(toolName: string) {
    super('tool_not_found', `tool not found: ${toolName}`);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolForbiddenError extends ToolError {
  constructor(toolName: string, reason: string) {
    super('tool_forbidden', `tool '${toolName}' forbidden: ${reason}`);
    this.name = 'ToolForbiddenError';
  }
}

export class ToolValidationError extends ToolError {
  constructor(toolName: string, issues: readonly { path: string; message: string }[]) {
    super('tool_validation', `tool '${toolName}' arguments failed validation`, issues);
    this.name = 'ToolValidationError';
  }
}

export class ToolNotImplementedError extends ToolError {
  constructor(toolName: string) {
    super(
      'tool_not_implemented',
      `tool '${toolName}' is accepted but not yet wired up (draft-write stub)`,
    );
    this.name = 'ToolNotImplementedError';
  }
}

export type ToolCallSuccess<T> = {
  ok: true;
  result: T;
  classification: ToolClass;
};

export type ToolCallFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ToolCallResult<T = unknown> = ToolCallSuccess<T> | ToolCallFailure;
