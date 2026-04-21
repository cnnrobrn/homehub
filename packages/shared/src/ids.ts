/**
 * Branded UUID identifier types.
 *
 * TypeScript's structural type system treats every `string` as assignable
 * to every other `string`, which is dangerous when we pass around
 * identifiers for different entities (a `HouseholdId` is not an `EventId`).
 * Branded types attach an unforgeable phantom tag that the compiler checks
 * at assignment time but that disappears at runtime — the actual value is
 * still just a UUID string.
 *
 * Construct branded IDs at trust boundaries (DB reads, validated inputs)
 * via the `as` cast or via a Zod schema's `.brand<'Name'>()`. Inside the
 * domain, never mint a branded ID from a raw string without validation.
 */

type Brand<T, B> = T & { readonly __brand: B };

export type HouseholdId = Brand<string, 'HouseholdId'>;
export type MemberId = Brand<string, 'MemberId'>;
export type EventId = Brand<string, 'EventId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type NodeId = Brand<string, 'NodeId'>;
export type FactId = Brand<string, 'FactId'>;
export type EpisodeId = Brand<string, 'EpisodeId'>;
export type SuggestionId = Brand<string, 'SuggestionId'>;
export type ActionId = Brand<string, 'ActionId'>;
export type ConnectionId = Brand<string, 'ConnectionId'>;

/**
 * Returns a v4 UUID as a plain `string`. Callers that need a branded ID
 * cast the result at the call site (`uuid() as HouseholdId`) — the cast
 * is intentional; the caller is asserting "I am minting an ID of this
 * entity type right now."
 *
 * Uses `crypto.randomUUID()` from the Web Crypto API, available in Node
 * 20+ globally.
 */
export function uuid(): string {
  return crypto.randomUUID();
}
