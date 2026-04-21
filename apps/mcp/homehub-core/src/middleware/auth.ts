/**
 * MCP auth middleware.
 *
 * Two token families per `specs/03-integrations/mcp.md`:
 *
 *   1. **Member tokens** (`hh_mcp_<base64url>`): issued from the
 *      HomeHub settings UI and persisted in `sync.mcp_token` (HMAC
 *      hash, not raw). On validation we resolve
 *      `(household_id, member_id, scopes[])`.
 *   2. **Service tokens** (HMAC-signed): internal background workers
 *      that need to call MCP tools. Uses the `MCP_SERVICE_HMAC_SECRET`
 *      shared secret and carries the target `household_id` in an
 *      `X-HomeHub-Household-Id` header, which we check against the
 *      signed payload before dispatch.
 *
 * The real `sync.mcp_token` table ships in migration `0012` (see the
 * integrations agent hand-off to `@infra-platform`). Until then:
 *
 *   - In `NODE_ENV !== 'production'` we read member tokens from an
 *     in-memory dev allowlist seeded by `MCP_DEV_TOKENS`
 *     (`token:householdId:memberId[,...]`).
 *   - In production we throw `NotYetImplementedError` — callers must
 *     wait for the migration.
 *
 * This file is the single choke point for MCP auth; every tool
 * handler receives a validated `AuthContext` and never sees the raw
 * `Authorization` header.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { type HouseholdId, type MemberId } from '@homehub/shared';
import { NotYetImplementedError } from '@homehub/worker-runtime';

import { type McpCoreEnv } from '../env.js';
import { ForbiddenError, InvalidTokenError } from '../errors.js';

/** Source of truth for who called the MCP server. */
export type AuthContext =
  | {
      kind: 'member';
      householdId: HouseholdId;
      memberId: MemberId;
      scopes: readonly string[];
      tokenId: string;
    }
  | {
      kind: 'service';
      householdId: HouseholdId;
      scopes: readonly string[];
      serviceName: string;
    };

interface DevAllowlistEntry {
  token: string;
  householdId: HouseholdId;
  memberId: MemberId;
  scopes: readonly string[];
}

export interface AuthMiddlewareOptions {
  env: McpCoreEnv;
  /** Escape hatch for tests. Defaults to `process.env.NODE_ENV`. */
  nodeEnv?: string;
}

export interface AuthMiddleware {
  /**
   * Validate the `Authorization` header + optional
   * `X-HomeHub-Household-Id` header. Throws
   * `InvalidTokenError` / `ForbiddenError` on failure.
   */
  authenticate(headers: Readonly<Record<string, string | undefined>>): AuthContext;
}

const MEMBER_TOKEN_PREFIX = 'hh_mcp_';
const SERVICE_TOKEN_PREFIX = 'hh_svc_';

/**
 * Parse a `hh_svc_<householdId>.<service>.<ts>.<hex-signature>` token
 * and verify the HMAC-SHA256 signature against the shared secret.
 *
 * The payload is `<householdId>.<service>.<ts>`; the signature is
 * hex-encoded SHA256(secret, payload). Using hex rather than
 * base64url keeps the token URL-safe without adding a dependency.
 */
function verifyServiceToken(
  token: string,
  secret: string,
): { householdId: HouseholdId; service: string } | null {
  if (!token.startsWith(SERVICE_TOKEN_PREFIX)) return null;
  const body = token.slice(SERVICE_TOKEN_PREFIX.length);
  const parts = body.split('.');
  if (parts.length !== 4) return null;
  const [householdId, service, ts, signature] = parts;
  if (!householdId || !service || !ts || !signature) return null;

  const payload = `${householdId}.${service}.${ts}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  // Signatures must be the same length before `timingSafeEqual`
  // runs — otherwise the compare itself throws. A length mismatch
  // is already a rejection, so short-circuit.
  if (expected.length !== signature.length) return null;
  const ok = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  if (!ok) return null;

  // 5 min clock skew window. Servers and clients run on Railway + the
  // app so NTP drift is bounded; anything older is treated as a
  // replay.
  const issuedAt = Number.parseInt(ts, 10);
  if (!Number.isFinite(issuedAt)) return null;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - issuedAt);
  if (ageSec > 300) return null;

  return { householdId: householdId as HouseholdId, service };
}

function parseDevAllowlist(raw: string | undefined): Map<string, DevAllowlistEntry> {
  const out = new Map<string, DevAllowlistEntry>();
  if (!raw) return out;
  for (const triple of raw.split(',')) {
    const trimmed = triple.trim();
    if (!trimmed) continue;
    const [token, householdId, memberId] = trimmed.split(':');
    if (!token || !householdId || !memberId) continue;
    out.set(token, {
      token,
      householdId: householdId as HouseholdId,
      memberId: memberId as MemberId,
      // Dev tokens get the full scope set — they only exist in
      // development and tests.
      scopes: ['*'],
    });
  }
  return out;
}

function extractBearer(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  return trimmed.slice(7).trim() || null;
}

function lookupHeader(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  // Node.js HTTP lower-cases incoming header keys; callers may pass
  // either style. Normalize.
  const lower = name.toLowerCase();
  const direct = headers[lower];
  if (direct !== undefined) return direct;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

export function createAuthMiddleware(opts: AuthMiddlewareOptions): AuthMiddleware {
  const { env } = opts;
  const nodeEnv = opts.nodeEnv ?? process.env['NODE_ENV'] ?? 'development';
  const isProd = nodeEnv === 'production';
  const allowlist = parseDevAllowlist(env.MCP_DEV_TOKENS);

  return {
    authenticate(headers) {
      const token = extractBearer(lookupHeader(headers, 'authorization'));
      if (!token) {
        throw new InvalidTokenError('missing or malformed Authorization bearer token');
      }

      // --- Service token path -----------------------------------------
      if (token.startsWith(SERVICE_TOKEN_PREFIX)) {
        if (!env.MCP_SERVICE_HMAC_SECRET) {
          throw new InvalidTokenError(
            'service tokens not accepted: MCP_SERVICE_HMAC_SECRET is unset',
          );
        }
        const parsed = verifyServiceToken(token, env.MCP_SERVICE_HMAC_SECRET);
        if (!parsed) {
          throw new InvalidTokenError('service token failed HMAC verification');
        }
        const requestedHousehold = lookupHeader(headers, 'x-homehub-household-id');
        if (!requestedHousehold) {
          throw new InvalidTokenError('service tokens require X-HomeHub-Household-Id header');
        }
        if (requestedHousehold !== parsed.householdId) {
          throw new ForbiddenError('service token not authorized for the requested household');
        }
        return {
          kind: 'service',
          householdId: parsed.householdId,
          scopes: ['*'],
          serviceName: parsed.service,
        };
      }

      // --- Member token path ------------------------------------------
      if (!token.startsWith(MEMBER_TOKEN_PREFIX)) {
        throw new InvalidTokenError('token does not match any known prefix');
      }

      if (isProd) {
        throw new NotYetImplementedError(
          'sync.mcp_token table pending — see @infra-platform for 0012_sync_mcp_token.sql',
        );
      }

      const entry = allowlist.get(token);
      if (!entry) {
        throw new InvalidTokenError('token not found in dev allowlist');
      }
      return {
        kind: 'member',
        householdId: entry.householdId,
        memberId: entry.memberId,
        scopes: entry.scopes,
        tokenId: `dev:${token.slice(MEMBER_TOKEN_PREFIX.length, MEMBER_TOKEN_PREFIX.length + 8)}`,
      };
    },
  };
}

/**
 * Expose the internal service-token builder so workers calling into
 * MCP (action-executor, consolidator, etc.) can mint tokens with the
 * same format the middleware expects. Lives here because the format
 * is the contract — the builder and the verifier must stay in
 * lockstep.
 */
export function signServiceToken(args: {
  householdId: string;
  service: string;
  secret: string;
  nowSec?: number;
}): string {
  const ts = (args.nowSec ?? Math.floor(Date.now() / 1000)).toString();
  const payload = `${args.householdId}.${args.service}.${ts}`;
  const signature = createHmac('sha256', args.secret).update(payload).digest('hex');
  return `${SERVICE_TOKEN_PREFIX}${payload}.${signature}`;
}
