import { describe, expect, it } from 'vitest';

import { resolveConnection } from './resolveConnection.js';
import { makeFakeSupabase } from './testutil.js';

describe('resolveConnection', () => {
  it('prefers the owner-member connection', async () => {
    const { supabase } = makeFakeSupabase({
      sync: {
        provider_connection: [
          {
            id: 'c-adult',
            household_id: 'h1',
            member_id: 'm-adult',
            provider: 'gcal',
            nango_connection_id: 'nango-adult',
            status: 'active',
          },
          {
            id: 'c-owner',
            household_id: 'h1',
            member_id: 'm-owner',
            provider: 'gcal',
            nango_connection_id: 'nango-owner',
            status: 'active',
          },
        ],
      },
      app: {
        member: [
          { id: 'm-adult', role: 'adult' },
          { id: 'm-owner', role: 'owner' },
        ],
      },
    });

    const conn = await resolveConnection(supabase, {
      householdId: 'h1',
      provider: 'gcal',
    });
    expect(conn).toEqual({
      connectionId: 'nango-owner',
      memberId: 'm-owner',
      connectionRowId: 'c-owner',
    });
  });

  it('falls back to an adult when no owner is connected', async () => {
    const { supabase } = makeFakeSupabase({
      sync: {
        provider_connection: [
          {
            id: 'c-adult',
            household_id: 'h1',
            member_id: 'm-adult',
            provider: 'gmail',
            nango_connection_id: 'nango-adult',
            status: 'active',
          },
        ],
      },
      app: { member: [{ id: 'm-adult', role: 'adult' }] },
    });

    const conn = await resolveConnection(supabase, {
      householdId: 'h1',
      provider: 'gmail',
    });
    expect(conn?.connectionId).toBe('nango-adult');
  });

  it('returns null when no active connection exists', async () => {
    const { supabase } = makeFakeSupabase({ sync: { provider_connection: [] } });
    const conn = await resolveConnection(supabase, {
      householdId: 'h1',
      provider: 'gcal',
    });
    expect(conn).toBeNull();
  });

  it('ignores revoked connections', async () => {
    const { supabase } = makeFakeSupabase({
      sync: {
        provider_connection: [
          {
            id: 'c1',
            household_id: 'h1',
            member_id: 'm1',
            provider: 'gcal',
            nango_connection_id: 'n1',
            status: 'revoked',
          },
        ],
      },
      app: { member: [{ id: 'm1', role: 'owner' }] },
    });
    const conn = await resolveConnection(supabase, {
      householdId: 'h1',
      provider: 'gcal',
    });
    expect(conn).toBeNull();
  });
});
