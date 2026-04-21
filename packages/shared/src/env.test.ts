import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { baseServerEnvSchema, loadEnv } from './env.js';

describe('baseServerEnvSchema', () => {
  it('applies defaults when only required keys are provided', () => {
    const parsed = loadEnv(baseServerEnvSchema, {} as NodeJS.ProcessEnv);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.OTEL_SERVICE_NAME).toBeUndefined();
    expect(parsed.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('accepts all valid NODE_ENV values', () => {
    for (const env of ['development', 'test', 'staging', 'production'] as const) {
      const parsed = loadEnv(baseServerEnvSchema, { NODE_ENV: env } as NodeJS.ProcessEnv);
      expect(parsed.NODE_ENV).toBe(env);
    }
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() =>
      loadEnv(baseServerEnvSchema, { LOG_LEVEL: 'chatty' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/LOG_LEVEL/);
  });

  it('rejects non-URL OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    expect(() =>
      loadEnv(baseServerEnvSchema, {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-url',
      } as NodeJS.ProcessEnv),
    ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it('aggregates multiple validation errors in one throw', () => {
    const schema = baseServerEnvSchema.extend({
      REQUIRED_A: z.string().min(1),
      REQUIRED_B: z.string().min(1),
    });
    expect(() => loadEnv(schema, {} as NodeJS.ProcessEnv)).toThrow(/REQUIRED_A[\s\S]*REQUIRED_B/);
  });
});
