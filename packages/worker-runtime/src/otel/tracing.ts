/**
 * OpenTelemetry bootstrap for workers.
 *
 * Call `initTracing(env)` once, before any instrumented library is
 * imported at runtime, to install the OTel Node SDK with OTLP export.
 * When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, tracing is a no-op and
 * we log a single warning so dev environments aren't spammed.
 *
 * Auto-instrumentations cover fetch and most common libraries; the
 * Supabase JS SDK goes through fetch under the hood, so its calls show
 * up in traces automatically.
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { type WorkerRuntimeEnv } from '../env.js';

export interface TracingHandle {
  /** Flushes pending spans and shuts the SDK down. Idempotent. */
  shutdown(): Promise<void>;
}

const NOOP_HANDLE: TracingHandle = {
  async shutdown() {
    /* no-op */
  },
};

export function initTracing(env: WorkerRuntimeEnv, serviceVersion = '0.0.0'): TracingHandle {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.warn('[worker-runtime] OTEL_EXPORTER_OTLP_ENDPOINT is not set; tracing is disabled.');
    return NOOP_HANDLE;
  }

  const serviceName = env.OTEL_SERVICE_NAME ?? 'homehub-worker';

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs is noisy and uninteresting for our workloads; disable.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  return {
    async shutdown() {
      await sdk.shutdown();
    },
  };
}
