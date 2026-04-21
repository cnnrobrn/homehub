/**
 * MCP-tool structured errors.
 *
 * Every tool handler and the auth middleware throws one of these instead
 * of a bare `Error`. We surface them in tool results using MCP's standard
 * error envelope (see `tool.ts`), and they carry a stable string `code`
 * so log backends can filter on it without parsing message text.
 */

type WithCode = { readonly code: string };

abstract class McpToolError extends Error implements WithCode {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * The `Authorization` header was missing, malformed, or the token did
 * not validate. Maps to a `401`-style MCP error.
 */
export class InvalidTokenError extends McpToolError {
  readonly code = 'MCP_INVALID_TOKEN';
}

/**
 * The token validated but is not authorized for the requested
 * household / scope / tool. Maps to a `403`-style MCP error.
 */
export class ForbiddenError extends McpToolError {
  readonly code = 'MCP_FORBIDDEN';
}

/**
 * Input did not pass the tool's Zod schema. The parse error message
 * is forwarded on `.message`.
 */
export class BadInputError extends McpToolError {
  readonly code = 'MCP_BAD_INPUT';
}

/**
 * The caller referenced a node / episode / member that doesn't exist
 * inside the caller's household. Distinct from a scoping failure —
 * this means "not there" not "not allowed."
 */
export class NotFoundError extends McpToolError {
  readonly code = 'MCP_NOT_FOUND';
}
