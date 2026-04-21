/**
 * Unit tests for household flows against an in-memory Supabase fake.
 *
 * We mock the Supabase client rather than booting a real Supabase stack.
 * Pros: fast, no Docker dependency in CI. Cons: the mock doesn't enforce
 * RLS or FK constraints — those are covered by `packages/db/tests/rls/`
 * which runs against a real stack in a separate CI job. That gives us
 * two independent layers:
 *   - Flow logic (this file) — control flow, authz branches, audit writes.
 *   - DB enforcement (pgTAP RLS suite) — "even if the flow is wrong, the
 *     database will refuse the write."
 */

import { type HouseholdId, type MemberId } from '@homehub/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { hashInvitationToken } from '../invitation/token.js';

import { type FakeStore, createFakeSupabase, createStore } from './__fixtures__/fake-supabase.js';
import {
  acceptInvitation,
  createHousehold,
  inviteMember,
  listHouseholds,
  listInvitations,
  listMembers,
  previewInvitation,
  resolveMemberId,
  revokeMember,
  transferOwnership,
  updateHousehold,
} from './flows.js';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  INVITATION_TOKEN_SECRET: 'a'.repeat(64),
  INVITATION_TTL_DAYS: 7,
};

let store: FakeStore;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supa: any;

beforeEach(() => {
  store = createStore();
  supa = createFakeSupabase(store);
});

function uuid(suffix: string): string {
  // Zod v4's UUID validator requires the RFC 4122 version + variant bits.
  // Build a v4 + variant-8 UUID from a deterministic suffix so tests can
  // cross-reference IDs without calling crypto.randomUUID().
  const hex = suffix
    .replace(/[^0-9a-f]/gi, '')
    .padStart(12, '0')
    .slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

describe('createHousehold', () => {
  it('creates household + owner member + all segment grants + audit event', async () => {
    const userId = uuid('1');
    const result = await createHousehold(supa, ENV, {
      userId,
      name: 'Test Home',
      timezone: 'America/New_York',
      currency: 'USD',
      weekStart: 'monday',
    });

    expect(result.household.name).toBe('Test Home');
    expect(result.household.settings).toMatchObject({
      timezone: 'America/New_York',
      currency: 'USD',
      week_start: 'monday',
    });
    expect(result.member.role).toBe('owner');
    expect(result.member.user_id).toBe(userId);
    expect(result.grants).toHaveLength(5);
    expect(result.grants.every((g) => g.access === 'write')).toBe(true);

    expect(store.app.household!.rows).toHaveLength(1);
    expect(store.app.member!.rows).toHaveLength(1);
    expect(store.app.member_segment_grant!.rows).toHaveLength(5);
    expect(store.audit.event!.rows).toHaveLength(1);
    expect(store.audit.event!.rows[0]!.action).toBe('household.create');
  });

  it('rejects invalid input via ValidationError', async () => {
    await expect(
      createHousehold(supa, ENV, { userId: 'not-a-uuid' as string, name: '' } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('inviteMember', () => {
  it('owner can invite; returns raw token + hashed token_hash; writes audit event', async () => {
    const { household, member } = await createHousehold(supa, ENV, {
      userId: uuid('1'),
      name: 'H',
    });

    const result = await inviteMember(supa, ENV, {
      householdId: household.id,
      inviterMemberId: member.id,
      email: 'friend@example.com',
      role: 'adult',
      grants: [
        { segment: 'food', access: 'write' },
        { segment: 'fun', access: 'read' },
      ],
    });

    expect(result.token.length).toBeGreaterThanOrEqual(42);
    expect(result.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(store.app.household_invitation!.rows).toHaveLength(1);
    expect(store.app.household_invitation!.rows[0]!.token_hash).toBe(result.tokenHash);
    expect(store.audit.event!.rows.some((r) => r.action === 'household.invite')).toBe(true);
  });

  it('adult without social:write cannot invite', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    // Manually create an adult member with no social grant.
    store.app.member!.rows.push({
      id: uuid('a'),
      household_id: owner.household.id,
      user_id: uuid('2'),
      display_name: 'Adult',
      role: 'adult',
      joined_at: new Date().toISOString(),
      email: null,
    });

    await expect(
      inviteMember(supa, ENV, {
        householdId: owner.household.id,
        inviterMemberId: uuid('a'),
        email: 'x@example.com',
        role: 'adult',
        grants: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('child cannot invite', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    store.app.member!.rows.push({
      id: uuid('c'),
      household_id: owner.household.id,
      user_id: uuid('3'),
      display_name: 'Kid',
      role: 'child',
      joined_at: new Date().toISOString(),
      email: null,
    });
    await expect(
      inviteMember(supa, ENV, {
        householdId: owner.household.id,
        inviterMemberId: uuid('c'),
        email: 'x@example.com',
        role: 'adult',
        grants: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('conflict when email already corresponds to a connected member', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    store.app.member!.rows.push({
      id: uuid('b'),
      household_id: owner.household.id,
      user_id: uuid('2'),
      display_name: 'Already',
      role: 'adult',
      joined_at: new Date().toISOString(),
      email: 'taken@example.com',
    });
    await expect(
      inviteMember(supa, ENV, {
        householdId: owner.household.id,
        inviterMemberId: owner.member.id,
        email: 'taken@example.com',
        role: 'adult',
        grants: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('acceptInvitation', () => {
  it('creates a new member row and applies grants', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'new@example.com',
      role: 'adult',
      grants: [{ segment: 'food', access: 'write' }],
    });

    const acceptUser = uuid('2');
    const res = await acceptInvitation(supa, ENV, { token: inv.token, userId: acceptUser });
    expect(res.alreadyAccepted).toBe(false);
    expect(res.role).toBe('adult');
    const member = store.app.member!.rows.find((m) => m.user_id === acceptUser);
    expect(member).toBeDefined();
    expect(member!.email).toBe('new@example.com');
    const grants = store.app.member_segment_grant!.rows.filter((g) => g.member_id === res.memberId);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.segment).toBe('food');
    // Invitation is marked accepted.
    const invRow = store.app.household_invitation!.rows[0]!;
    expect(invRow.accepted_at).toBeTruthy();
    expect(invRow.accepted_by).toBe(res.memberId);
  });

  it('upgrades an existing non-connected member in place', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    // Pre-existing non_connected row with the same email.
    const placeholderId = uuid('p');
    store.app.member!.rows.push({
      id: placeholderId,
      household_id: owner.household.id,
      user_id: null,
      display_name: 'Grandma',
      role: 'non_connected',
      joined_at: null,
      email: 'g@example.com',
    });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'g@example.com',
      role: 'adult',
      grants: [],
    });
    const userId = uuid('2');
    const res = await acceptInvitation(supa, ENV, { token: inv.token, userId });
    expect(res.memberId).toBe(placeholderId);
    const row = store.app.member!.rows.find((m) => m.id === placeholderId)!;
    expect(row.user_id).toBe(userId);
    expect(row.role).toBe('adult');
    expect(row.joined_at).toBeTruthy();
  });

  it('is idempotent — second acceptance returns alreadyAccepted=true', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'idem@example.com',
      role: 'adult',
      grants: [],
    });
    const userId = uuid('2');
    await acceptInvitation(supa, ENV, { token: inv.token, userId });
    const second = await acceptInvitation(supa, ENV, { token: inv.token, userId });
    expect(second.alreadyAccepted).toBe(true);
  });

  it('rejects expired invitation', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'exp@example.com',
      role: 'adult',
      grants: [],
    });
    // Force the invitation expired.
    const row = store.app.household_invitation!.rows[0]!;
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(
      acceptInvitation(supa, ENV, { token: inv.token, userId: uuid('2') }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects unknown token with NotFoundError', async () => {
    await expect(
      acceptInvitation(supa, ENV, { token: 'made-up', userId: uuid('2') }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hashes the token with the configured secret', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'x@example.com',
      role: 'adult',
      grants: [],
    });
    expect(inv.tokenHash).toBe(hashInvitationToken(inv.token, ENV.INVITATION_TOKEN_SECRET));
  });
});

describe('listHouseholds', () => {
  it('returns all households the user is a member of, sorted by joined_at asc', async () => {
    const u = uuid('1');
    // Two households.
    const a = await createHousehold(supa, ENV, { userId: u, name: 'Alpha' });
    const b = await createHousehold(supa, ENV, { userId: u, name: 'Beta' });
    // Force deterministic ordering.
    store.app.member!.rows.find((m) => m.household_id === a.household.id)!.joined_at =
      '2026-01-01T00:00:00Z';
    store.app.member!.rows.find((m) => m.household_id === b.household.id)!.joined_at =
      '2026-02-01T00:00:00Z';

    const res = await listHouseholds(supa, ENV, { userId: u });
    expect(res.map((r) => r.household.name)).toEqual(['Alpha', 'Beta']);
  });
});

describe('listMembers', () => {
  it('returns members with grants; requestor must be a member', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const res = await listMembers(supa, ENV, {
      householdId: owner.household.id,
      requestorMemberId: owner.member.id,
    });
    expect(res).toHaveLength(1);
    expect(res[0]!.grants).toHaveLength(5);
    expect(res[0]!.connected).toBe(true);
  });

  it('forbids non-members', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    await expect(
      listMembers(supa, ENV, {
        householdId: owner.household.id,
        requestorMemberId: uuid('x'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('revokeMember', () => {
  it('owner drops target to guest, strips grants, audits', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const targetId = uuid('t');
    store.app.member!.rows.push({
      id: targetId,
      household_id: owner.household.id,
      user_id: uuid('2'),
      display_name: 'Bob',
      role: 'adult',
      joined_at: new Date().toISOString(),
      email: 'bob@example.com',
    });
    store.app.member_segment_grant!.rows.push({
      id: uuid('g'),
      member_id: targetId,
      segment: 'food',
      access: 'write',
    });

    await revokeMember(supa, ENV, {
      householdId: owner.household.id as HouseholdId,
      actorMemberId: owner.member.id as MemberId,
      targetMemberId: targetId as MemberId,
    });

    const updated = store.app.member!.rows.find((m) => m.id === targetId)!;
    expect(updated.role).toBe('guest');
    expect(
      store.app.member_segment_grant!.rows.filter((g) => g.member_id === targetId),
    ).toHaveLength(0);
    expect(store.audit.event!.rows.some((r) => r.action === 'household.member.revoke')).toBe(true);
  });

  it('cannot revoke self', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    await expect(
      revokeMember(supa, ENV, {
        householdId: owner.household.id,
        actorMemberId: owner.member.id,
        targetMemberId: owner.member.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('non-owner cannot revoke', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const actorId = uuid('a');
    store.app.member!.rows.push({
      id: actorId,
      household_id: owner.household.id,
      user_id: uuid('2'),
      display_name: 'Adult',
      role: 'adult',
      joined_at: new Date().toISOString(),
      email: null,
    });
    await expect(
      revokeMember(supa, ENV, {
        householdId: owner.household.id,
        actorMemberId: actorId,
        targetMemberId: owner.member.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('transferOwnership', () => {
  it('swaps owner + adult roles atomically; audits', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const newOwnerId = uuid('n');
    store.app.member!.rows.push({
      id: newOwnerId,
      household_id: owner.household.id,
      user_id: uuid('2'),
      display_name: 'Heir',
      role: 'adult',
      joined_at: new Date().toISOString(),
      email: null,
    });
    await transferOwnership(supa, ENV, {
      householdId: owner.household.id,
      currentOwnerMemberId: owner.member.id,
      newOwnerMemberId: newOwnerId,
    });
    const updated = store.app.member!.rows;
    expect(updated.find((m) => m.id === newOwnerId)!.role).toBe('owner');
    expect(updated.find((m) => m.id === owner.member.id)!.role).toBe('adult');
    expect(store.audit.event!.rows.some((r) => r.action === 'household.ownership.transfer')).toBe(
      true,
    );
  });

  it('rejects transfer to non-adult / unconnected', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const ncId = uuid('nc');
    store.app.member!.rows.push({
      id: ncId,
      household_id: owner.household.id,
      user_id: null,
      display_name: 'Grandma',
      role: 'non_connected',
      joined_at: null,
      email: null,
    });
    await expect(
      transferOwnership(supa, ENV, {
        householdId: owner.household.id,
        currentOwnerMemberId: owner.member.id,
        newOwnerMemberId: ncId,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('resolveMemberId', () => {
  it('returns member id for (household, user)', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const id = await resolveMemberId(supa, owner.household.id, uuid('1'));
    expect(id).toBe(owner.member.id);
  });

  it('returns null when no membership', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const id = await resolveMemberId(supa, owner.household.id, uuid('9'));
    expect(id).toBeNull();
  });
});

describe('previewInvitation', () => {
  it('returns household + role + status=valid for a live token', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'Preview H' });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'p@example.com',
      role: 'adult',
      grants: [],
    });
    const res = await previewInvitation(supa, ENV, { token: inv.token });
    expect(res).not.toBeNull();
    expect(res!.status).toBe('valid');
    expect(res!.household.name).toBe('Preview H');
    expect(res!.role).toBe('adult');
    expect(res!.email).toBe('p@example.com');
    expect(res!.inviterName).toBe(owner.member.display_name);
  });

  it('returns null for an unknown token', async () => {
    const res = await previewInvitation(supa, ENV, { token: 'nope' });
    expect(res).toBeNull();
  });

  it('reports status=expired for stale invitations', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'e@example.com',
      role: 'adult',
      grants: [],
    });
    store.app.household_invitation!.rows[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await previewInvitation(supa, ENV, { token: inv.token });
    expect(res!.status).toBe('expired');
  });

  it('reports status=accepted after acceptance', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'a@example.com',
      role: 'adult',
      grants: [],
    });
    await acceptInvitation(supa, ENV, { token: inv.token, userId: uuid('2') });
    const res = await previewInvitation(supa, ENV, { token: inv.token });
    expect(res!.status).toBe('accepted');
  });
});

describe('updateHousehold', () => {
  it('owner can patch name + settings; audit written', async () => {
    const owner = await createHousehold(supa, ENV, {
      userId: uuid('1'),
      name: 'Old Name',
      timezone: 'America/New_York',
    });
    const res = await updateHousehold(supa, ENV, {
      householdId: owner.household.id,
      actorMemberId: owner.member.id,
      name: 'New Name',
      currency: 'EUR',
    });
    expect(res.household.name).toBe('New Name');
    expect(res.household.settings).toMatchObject({
      timezone: 'America/New_York',
      currency: 'EUR',
    });
    expect(store.audit.event!.rows.some((r) => r.action === 'household.update')).toBe(true);
  });

  it('non-owner rejected with Forbidden', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const adultId = uuid('a');
    store.app.member!.rows.push({
      id: adultId,
      household_id: owner.household.id,
      user_id: uuid('2'),
      display_name: 'A',
      role: 'adult',
      joined_at: new Date().toISOString(),
      email: null,
    });
    await expect(
      updateHousehold(supa, ENV, {
        householdId: owner.household.id,
        actorMemberId: adultId,
        name: 'X',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects bogus inputs', async () => {
    await expect(
      updateHousehold(supa, ENV, {
        householdId: 'not-a-uuid',
        actorMemberId: uuid('1'),
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('listInvitations', () => {
  it('returns pending invitations newest first', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const inv1 = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'one@example.com',
      role: 'adult',
      grants: [],
    });
    // Force oldest created_at so sort is deterministic.
    store.app.household_invitation!.rows[0]!.created_at = '2026-01-01T00:00:00Z';
    const inv2 = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'two@example.com',
      role: 'adult',
      grants: [],
    });
    store.app.household_invitation!.rows[1]!.created_at = '2026-02-01T00:00:00Z';
    // Touch inv1+inv2 so lint doesn't flag them unused.
    expect(inv1.token.length).toBeGreaterThan(0);
    expect(inv2.token.length).toBeGreaterThan(0);

    const res = await listInvitations(supa, ENV, {
      householdId: owner.household.id,
      requestorMemberId: owner.member.id,
    });
    expect(res).toHaveLength(2);
    expect(res[0]!.email).toBe('two@example.com');
    expect(res[1]!.email).toBe('one@example.com');
    // Token must never be exposed on list.
    expect(res[0]!.token).toBeNull();
  });

  it('excludes accepted invitations', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    const inv = await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'x@example.com',
      role: 'adult',
      grants: [],
    });
    await acceptInvitation(supa, ENV, { token: inv.token, userId: uuid('2') });
    const res = await listInvitations(supa, ENV, {
      householdId: owner.household.id,
      requestorMemberId: owner.member.id,
    });
    expect(res).toHaveLength(0);
  });

  it('excludes expired invitations', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    await inviteMember(supa, ENV, {
      householdId: owner.household.id,
      inviterMemberId: owner.member.id,
      email: 'z@example.com',
      role: 'adult',
      grants: [],
    });
    store.app.household_invitation!.rows[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await listInvitations(supa, ENV, {
      householdId: owner.household.id,
      requestorMemberId: owner.member.id,
    });
    expect(res).toHaveLength(0);
  });

  it('forbids non-members', async () => {
    const owner = await createHousehold(supa, ENV, { userId: uuid('1'), name: 'H' });
    await expect(
      listInvitations(supa, ENV, {
        householdId: owner.household.id,
        requestorMemberId: uuid('9'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
