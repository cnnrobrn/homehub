/**
 * Nango client wrapper.
 *
 * We use the official `@nangohq/node` SDK. Rationale: Nango is our
 * OAuth broker (`specs/03-integrations/nango.md`); every provider token
 * lives inside Nango and every outbound request from a sync worker
 * proxies through Nango so we never touch refresh tokens in app code.
 * The official SDK handles retries, signed requests, and already-known
 * response shapes — wrapping a plain fetch would reinvent it poorly.
 *
 * The wrapper narrows the SDK's surface to the methods HomeHub actually
 * uses (proxy, getConnection, listConnections) and translates SDK
 * errors into `NangoError` so call sites never catch `any`. All token
 * refresh stays inside Nango itself.
 */

import { Nango, type ProxyConfiguration } from '@nangohq/node';

import { type WorkerRuntimeEnv } from '../env.js';
import { NangoError } from '../errors.js';

export interface ProxyOptions {
  providerConfigKey: string;
  connectionId: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  data?: unknown;
  params?: Record<string, string | number | string[] | number[]>;
  headers?: Record<string, string>;
}

export interface NangoConnection {
  connection_id: string;
  provider_config_key: string;
  provider: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown> | null;
}

export interface ConnectSessionEndUser {
  id: string;
  email?: string;
  displayName?: string;
  tags?: Record<string, string>;
}

export interface CreateConnectSessionOptions {
  endUser: ConnectSessionEndUser;
  /**
   * Restricts the hosted-auth page to a single provider (e.g.
   * `'google-calendar'`). HomeHub always scopes to exactly one.
   */
  allowedIntegrations: string[];
  /**
   * Free-form tags applied to the created session/connection. HomeHub
   * stamps `{ household_id, member_id, provider }` so the
   * `connection.created` webhook can resolve the target row.
   */
  tags?: Record<string, string>;
}

export interface CreateConnectSessionResult {
  token: string;
  connectLink: string;
  expiresAt: string;
}

export interface NangoClient {
  proxy<T = unknown>(options: ProxyOptions): Promise<T>;
  getConnection(providerConfigKey: string, connectionId: string): Promise<NangoConnection>;
  listConnections(): Promise<NangoConnection[]>;
  createConnectSession(options: CreateConnectSessionOptions): Promise<CreateConnectSessionResult>;
  deleteConnection(providerConfigKey: string, connectionId: string): Promise<void>;
}

export function createNangoClient(env: WorkerRuntimeEnv): NangoClient {
  if (!env.NANGO_HOST || !env.NANGO_SECRET_KEY) {
    throw new Error('createNangoClient: NANGO_HOST and NANGO_SECRET_KEY must be set');
  }

  const nango = new Nango({
    host: env.NANGO_HOST,
    secretKey: env.NANGO_SECRET_KEY,
  });

  return {
    async proxy<T = unknown>(options: ProxyOptions): Promise<T> {
      const config: ProxyConfiguration = {
        providerConfigKey: options.providerConfigKey,
        connectionId: options.connectionId,
        method: options.method ?? 'GET',
        endpoint: options.endpoint,
        ...(options.data !== undefined ? { data: options.data } : {}),
        ...(options.params ? { params: options.params } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
      };
      try {
        const response = await nango.proxy(config);
        return response.data as T;
      } catch (error) {
        throw new NangoError(
          `nango.proxy ${options.method ?? 'GET'} ${options.endpoint} failed`,
          {
            providerConfigKey: options.providerConfigKey,
            connectionId: options.connectionId,
          },
          { cause: error },
        );
      }
    },

    async getConnection(providerConfigKey, connectionId) {
      try {
        const connection = await nango.getConnection(providerConfigKey, connectionId);
        return connection as unknown as NangoConnection;
      } catch (error) {
        throw new NangoError(
          'nango.getConnection failed',
          { providerConfigKey, connectionId },
          { cause: error },
        );
      }
    },

    async listConnections() {
      try {
        const result = await nango.listConnections();
        const raw = (result as { connections?: unknown[] }).connections ?? [];
        return raw as NangoConnection[];
      } catch (error) {
        throw new NangoError('nango.listConnections failed', {}, { cause: error });
      }
    },

    async createConnectSession(options) {
      try {
        // The Nango SDK's body type uses snake_case; map our camelCase
        // surface onto it. `end_user.id` is a free-form stable id from
        // HomeHub — we pass `member_id:<uuid>` for traceability.
        const body = {
          end_user: {
            id: options.endUser.id,
            ...(options.endUser.email ? { email: options.endUser.email } : {}),
            ...(options.endUser.displayName ? { display_name: options.endUser.displayName } : {}),
            ...(options.endUser.tags ? { tags: options.endUser.tags } : {}),
          },
          allowed_integrations: options.allowedIntegrations,
          ...(options.tags ? { tags: options.tags } : {}),
        };
        const result = (await (
          nango as unknown as {
            createConnectSession: (
              body: unknown,
            ) => Promise<{ data: { token: string; connect_link: string; expires_at: string } }>;
          }
        ).createConnectSession(body)) as {
          data: { token: string; connect_link: string; expires_at: string };
        };
        return {
          token: result.data.token,
          connectLink: result.data.connect_link,
          expiresAt: result.data.expires_at,
        };
      } catch (error) {
        throw new NangoError('nango.createConnectSession failed', {}, { cause: error });
      }
    },

    async deleteConnection(providerConfigKey, connectionId) {
      try {
        await nango.deleteConnection(providerConfigKey, connectionId);
      } catch (error) {
        throw new NangoError(
          'nango.deleteConnection failed',
          { providerConfigKey, connectionId },
          { cause: error },
        );
      }
    },
  };
}
