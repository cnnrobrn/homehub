/**
 * Unit tests for the Nango client wrapper.
 *
 * We mock `@nangohq/node` at the module level and assert that our
 * camelCase / snake_case translation and error-wrapping behaviors hold.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { nangoMock } = vi.hoisted(() => ({
  nangoMock: {
    proxy: vi.fn(),
    getConnection: vi.fn(),
    listConnections: vi.fn(),
    createConnectSession: vi.fn(),
    deleteConnection: vi.fn(),
  },
}));

vi.mock('@nangohq/node', () => ({
  // The SDK's default export is a class constructed with `new`. Use a
  // class returning the mock so `new Nango(...)` resolves to our shared
  // instance.
  Nango: class {
    constructor() {
      return nangoMock as unknown as object;
    }
  },
}));

import { NangoError } from '../errors.js';

import { createNangoClient } from './client.js';

const env = {
  NANGO_HOST: 'https://nango.example.com',
  NANGO_SECRET_KEY: 'sk',
} as Parameters<typeof createNangoClient>[0];

beforeEach(() => {
  nangoMock.proxy.mockReset();
  nangoMock.getConnection.mockReset();
  nangoMock.listConnections.mockReset();
  nangoMock.createConnectSession.mockReset();
  nangoMock.deleteConnection.mockReset();
});

describe('createConnectSession', () => {
  it('translates camelCase to snake_case and unwraps data', async () => {
    nangoMock.createConnectSession.mockResolvedValue({
      data: {
        token: 't',
        connect_link: 'https://nango.example.com/connect/t',
        expires_at: '2026-04-21T00:00:00Z',
      },
    });
    const client = createNangoClient(env);
    const result = await client.createConnectSession({
      endUser: { id: 'member:abc', email: 'a@b.com', displayName: 'A' },
      allowedIntegrations: ['google-calendar'],
      tags: { household_id: 'hh-1' },
    });
    expect(result).toEqual({
      token: 't',
      connectLink: 'https://nango.example.com/connect/t',
      expiresAt: '2026-04-21T00:00:00Z',
    });
    expect(nangoMock.createConnectSession).toHaveBeenCalledWith({
      end_user: { id: 'member:abc', email: 'a@b.com', display_name: 'A' },
      allowed_integrations: ['google-calendar'],
      tags: { household_id: 'hh-1' },
    });
  });

  it('wraps SDK errors in NangoError', async () => {
    nangoMock.createConnectSession.mockRejectedValue(new Error('boom'));
    const client = createNangoClient(env);
    await expect(
      client.createConnectSession({
        endUser: { id: 'x' },
        allowedIntegrations: ['google-calendar'],
      }),
    ).rejects.toBeInstanceOf(NangoError);
  });
});

describe('deleteConnection', () => {
  it('forwards to the SDK and resolves void', async () => {
    nangoMock.deleteConnection.mockResolvedValue({ status: 204 });
    const client = createNangoClient(env);
    await expect(client.deleteConnection('google-calendar', 'conn-1')).resolves.toBeUndefined();
    expect(nangoMock.deleteConnection).toHaveBeenCalledWith('google-calendar', 'conn-1');
  });

  it('wraps SDK errors', async () => {
    nangoMock.deleteConnection.mockRejectedValue(new Error('nope'));
    const client = createNangoClient(env);
    await expect(client.deleteConnection('google-calendar', 'conn-1')).rejects.toBeInstanceOf(
      NangoError,
    );
  });
});
