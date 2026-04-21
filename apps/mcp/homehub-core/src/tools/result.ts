/**
 * Shared MCP tool helpers.
 *
 * Every tool's handler returns the same envelope shape (a single
 * `application/json` content block). Helpers here keep that shape in
 * one place so Zod-driven handlers don't diverge on accident.
 */

import { type z } from 'zod';

import { BadInputError } from '../errors.js';

/**
 * MCP `CallToolResult`-compatible envelope returned by every tool.
 *
 * We intentionally stick to `content: [{ type: 'text', text: json }]`
 * rather than a bespoke `structuredContent` block — the MCP spec
 * allows both, but `content[0].text` is the widest client support
 * surface today.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string; mimeType?: string }>;
  isError?: boolean;
}

export function jsonResult(value: unknown): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value),
        mimeType: 'application/json',
      },
    ],
  };
}

export function errorResult(message: string, code: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: { code, message } }),
        mimeType: 'application/json',
      },
    ],
    isError: true,
  };
}

/**
 * Wrap Zod parsing so a parse failure becomes a typed
 * `BadInputError`. Tool handlers wrap this around the MCP SDK's
 * already-validated input to double-check — the SDK can only
 * JSON-schema-validate and won't rerun refinements.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadInputError(result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}
