/**
 * Nango client factory for the web app.
 *
 * Server-only. Do NOT import from client code — it would attempt to
 * read `NANGO_SECRET_KEY` from `process.env` in the browser.
 *
 * We keep the web-app copy lean: only the two methods server-side
 * routes need (`createConnectSession`, `deleteConnection`). The workers
 * use `@homehub/worker-runtime`'s richer wrapper.
 */

import { Nango } from '@nangohq/node';

import { serverEnv } from '@/lib/env';

export interface WebNangoClient {
  createConnectSession(args: {
    endUser: { id: string; email?: string; displayName?: string; tags?: Record<string, string> };
    allowedIntegrations: string[];
    tags?: Record<string, string>;
  }): Promise<{ token: string; connectLink: string; expiresAt: string }>;
  deleteConnection(providerConfigKey: string, connectionId: string): Promise<void>;
}

export class NangoNotConfiguredError extends Error {
  readonly code = 'NANGO_NOT_CONFIGURED';
  constructor() {
    super('NANGO_HOST and NANGO_SECRET_KEY must be set to use integration routes');
  }
}

export function createWebNangoClient(): WebNangoClient {
  const env = serverEnv();
  if (!env.NANGO_HOST || !env.NANGO_SECRET_KEY) {
    throw new NangoNotConfiguredError();
  }
  const nango = new Nango({ host: env.NANGO_HOST, secretKey: env.NANGO_SECRET_KEY });

  return {
    async createConnectSession(args) {
      // Map camelCase to Nango's snake_case session body. See
      // `packages/worker-runtime/src/nango/client.ts` for the worker copy.
      const body = {
        end_user: {
          id: args.endUser.id,
          ...(args.endUser.email ? { email: args.endUser.email } : {}),
          ...(args.endUser.displayName ? { display_name: args.endUser.displayName } : {}),
          ...(args.endUser.tags ? { tags: args.endUser.tags } : {}),
        },
        allowed_integrations: args.allowedIntegrations,
        ...(args.tags ? { tags: args.tags } : {}),
      };
      // The SDK's camelCase method takes a snake_case body.
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
    },

    async deleteConnection(providerConfigKey, connectionId) {
      await nango.deleteConnection(providerConfigKey, connectionId);
    },
  };
}
