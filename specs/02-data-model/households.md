# Households & Membership

**Purpose.** How users, households, and per-segment sharing work.

**Scope.** Invitation flow, roles, the "non-connected member" pattern, and per-segment grants.

## Concept

A **household** is a set of **members**. A member may be a fully-connected user, a child account, or a non-connected reference (e.g., Grandma).

A user can belong to multiple households. They might be in their own "Priya" household and also in the "Martin Family" household.

## Members

```
role ∈ { 'owner', 'adult', 'child', 'guest', 'non_connected' }
```

- **owner** — created the household; can invite, remove, transfer ownership, delete.
- **adult** — full read/write across granted segments.
- **child** — limited write; no Financial access by default.
- **guest** — read-only; used for temporary access (e.g., a visiting nanny).
- **non_connected** — no user account. Exists so the household can plan around them and mention them in memory.

## Per-segment grants

Household membership alone doesn't grant access to every segment. Each member has a row in `app.member_segment_grant`:

```
member_id, segment, access: 'none'|'read'|'write'
```

Defaults:

- `owner`, `adult`: `write` for Food, Fun, Social; `write` for Financial (can be downgraded).
- `child`: `write` Food/Fun, `read` Social, `none` Financial.
- `guest`: `read` everything except Financial.
- `non_connected`: n/a (not a user).

The roommate (Okonkwo) case: three owner-equivalent adults with Financial set to `none` for each other's accounts, but `write` for shared expenses. Handled by `account_grant` overrides (see [`row-level-security.md`](./row-level-security.md)).

## Invitations

1. Owner creates invite: email + proposed role + proposed grants.
2. System sends email with magic link (Supabase Auth email).
3. Recipient signs in. On first login, a `member` row is created with `status: joined`.
4. Invites expire after 7 days; re-issuable.

## Non-connected members

Created directly by an owner: just a `display_name`, optional `relationship`. No user account ever attaches unless they later accept an invite, at which point the same member row is upgraded.

## Ownership transfer / deletion

- Ownership transfer requires target to be an existing `adult` member.
- Deleting a household is a soft-delete with a 30-day tombstone; data is purged after the window.

## Dependencies

- [`schema.md`](./schema.md)
- [`row-level-security.md`](./row-level-security.md)
- [`../09-security/auth.md`](../09-security/auth.md)

## Open questions

- Does a member's history follow them out of a household when removed, or is it scrubbed from the household's memory graph? Leaning: keep the graph (household-scoped), strip the member's connections (member-scoped), and leave a "Bob (former member)" node.
- Can two households merge? Not in v1. Workaround: export + manual re-entry.
