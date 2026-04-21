/**
 * OpenRouter `generate()` helper.
 *
 * One function call per model invocation. Every HomeHub model call goes
 * through this client so routing, caching, structured-output handling,
 * fallback, and the `model_calls` log row stay consistent.
 *
 * Spec references:
 *   - `specs/05-agents/model-routing.md` — tiers, default params,
 *     per-task caching behavior, per-household budgets, model_calls
 *     logging.
 *   - `specs/01-architecture/stack.md` — OpenRouter is the gateway.
 *
 * The `model_calls` table doesn't exist yet (lands in M1). We keep the
 * write attempt behind a try/catch that logs once and becomes a no-op
 * so the interface is stable today — call sites don't change when the
 * migration ships.
 */

import { type HouseholdId } from '@homehub/shared';
import { type z } from 'zod';

import { type WorkerRuntimeEnv } from '../env.js';
import { ModelCallError, StructuredOutputError } from '../errors.js';
import { type Logger } from '../log/logger.js';
import { type ServiceSupabaseClient } from '../supabase/client.js';

import { resolveDefaults } from './defaults.js';

export interface GenerateArgs<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  task: string;
  household_id: HouseholdId;
  systemPrompt: string;
  userPrompt: string;
  /** Overrides the task default. */
  model?: string;
  schema?: TSchema;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  /** `'auto'` enables OpenRouter prompt caching on supported providers. */
  cache?: 'auto' | 'off';
  fallbackModel?: string;
}

export interface GenerateResult<T = unknown> {
  text: string;
  parsed: T | undefined;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface ModelClient {
  generate<TSchema extends z.ZodTypeAny = z.ZodTypeAny>(
    args: GenerateArgs<TSchema>,
  ): Promise<GenerateResult<z.infer<TSchema>>>;
}

export interface CreateModelClientOptions {
  supabase?: ServiceSupabaseClient;
  logger: Logger;
  /** Injectable for tests so we never make real network calls. */
  fetchImpl?: typeof fetch;
}

/**
 * OpenRouter chat-completion response shape (trimmed to the fields we
 * use). `usage.cost` is an OpenRouter-specific extension that reports
 * the USD cost of the call; when absent we log 0 and move on.
 */
interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      role?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
}

function extractText(response: ChatCompletionResponse): string {
  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') {
    throw new ModelCallError(
      'OpenRouter response had no text content',
      response.model ?? 'unknown',
    );
  }
  return content;
}

/**
 * One-shot `model_calls` insert. The table doesn't exist yet — M1 adds
 * it. We issue the call through Supabase RPC because the shape of the
 * write doesn't change whether it's a direct insert or via a helper
 * function; until the migration lands, every call silently becomes a
 * no-op after the first warning. When the table arrives, no call site
 * needs to change.
 */
function createModelCallsRecorder(
  supabase: ServiceSupabaseClient | undefined,
  logger: Logger,
): (row: {
  household_id: string;
  task: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  at: string;
}) => Promise<void> {
  let warned = false;
  let disabled = false;

  return async (row) => {
    if (!supabase || disabled) return;
    try {
      const { error } = await supabase
        .schema('app')
        // TODO(M1): `app.model_calls` lands in the model-routing migration.
        .from('model_calls' as never)
        .insert(row as never);
      if (error) {
        // 42P01 = undefined_table; any other error should still surface.
        const code = (error as unknown as { code?: string }).code ?? '';
        if (code === '42P01' || code === 'PGRST205') {
          if (!warned) {
            logger.warn(
              'app.model_calls table not yet provisioned; cost tracking disabled until M1',
              { code },
            );
            warned = true;
          }
          disabled = true;
          return;
        }
        logger.warn('model_calls insert failed', { error: error.message });
      }
    } catch (err) {
      // First failure: warn and disable. We never want the recorder to
      // break a model call.
      if (!warned) {
        logger.warn('model_calls recorder disabled after unexpected error', {
          error: err instanceof Error ? err.message : String(err),
        });
        warned = true;
      }
      disabled = true;
    }
  };
}

export function createModelClient(
  env: WorkerRuntimeEnv,
  options: CreateModelClientOptions,
): ModelClient {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('createModelClient: OPENROUTER_API_KEY is not set');
  }
  const { logger, supabase, fetchImpl } = options;
  const doFetch = fetchImpl ?? globalThis.fetch;
  const endpoint = `${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const recordCall = createModelCallsRecorder(supabase, logger);

  async function callOnce(args: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    jsonMode: boolean;
    cache: boolean;
  }): Promise<ChatCompletionResponse> {
    // OpenRouter prompt-caching hint. The exact shape follows
    // OpenRouter's documented `cache_control` extension; providers that
    // don't support it ignore the field.
    const systemBlock = args.cache
      ? [
          {
            type: 'text',
            text: args.systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ]
      : args.systemPrompt;

    const body = {
      model: args.model,
      messages: [
        { role: 'system', content: systemBlock },
        { role: 'user', content: args.userPrompt },
      ],
      temperature: args.temperature,
      top_p: args.topP,
      max_tokens: args.maxOutputTokens,
      ...(args.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      usage: { include: true },
    };

    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.OPENROUTER_HTTP_REFERER,
        'X-Title': env.OPENROUTER_APP_TITLE,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ModelCallError(`OpenRouter HTTP ${res.status}: ${text.slice(0, 500)}`, args.model);
    }
    return (await res.json()) as ChatCompletionResponse;
  }

  return {
    async generate(args) {
      const defaults = resolveDefaults(args.task);
      const model = args.model ?? defaults.model;
      const temperature = args.temperature ?? defaults.temperature;
      const topP = args.topP ?? defaults.topP;
      const maxOutputTokens = args.maxOutputTokens ?? defaults.maxOutputTokens;
      const wantJson = args.schema !== undefined || defaults.jsonMode;
      const cache = (args.cache ?? 'auto') === 'auto';

      const started = Date.now();
      let response: ChatCompletionResponse;
      let usedModel = model;

      try {
        response = await callOnce({
          model,
          systemPrompt: args.systemPrompt,
          userPrompt: args.userPrompt,
          temperature,
          topP,
          maxOutputTokens,
          jsonMode: wantJson,
          cache,
        });
      } catch (err) {
        // Retry once against the fallback model (or let OpenRouter
        // fall back on its own if none is configured).
        if (args.fallbackModel) {
          logger.warn('model call failed, retrying with fallback', {
            household_id: args.household_id,
            task: args.task,
            model,
            fallbackModel: args.fallbackModel,
            error: err instanceof Error ? err.message : String(err),
          });
          try {
            response = await callOnce({
              model: args.fallbackModel,
              systemPrompt: args.systemPrompt,
              userPrompt: args.userPrompt,
              temperature,
              topP,
              maxOutputTokens,
              jsonMode: wantJson,
              cache,
            });
            usedModel = args.fallbackModel;
          } catch (err2) {
            throw new ModelCallError(
              `model call failed (primary and fallback)`,
              args.fallbackModel,
              { cause: err2 },
            );
          }
        } else {
          throw err instanceof ModelCallError
            ? err
            : new ModelCallError('model call failed', model, { cause: err });
        }
      }

      const latencyMs = Date.now() - started;
      const text = extractText(response);
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const costUsd = response.usage?.cost ?? 0;

      // Structured output: parse + validate, retry once with corrective
      // suffix, then throw.
      let parsed: unknown = undefined;
      if (args.schema) {
        const tryParse = (
          raw: string,
        ): { ok: true; value: unknown } | { ok: false; error: unknown } => {
          try {
            const json = JSON.parse(raw);
            const result = args.schema!.safeParse(json);
            if (!result.success) return { ok: false, error: result.error };
            return { ok: true, value: result.data };
          } catch (err) {
            return { ok: false, error: err };
          }
        };

        let parseResult = tryParse(text);
        let finalText = text;
        if (!parseResult.ok) {
          logger.warn('structured output parse failed, retrying with corrective prompt', {
            household_id: args.household_id,
            task: args.task,
            model: usedModel,
          });
          const retry = await callOnce({
            model: usedModel,
            systemPrompt: args.systemPrompt,
            userPrompt:
              args.userPrompt +
              '\n\n[Your previous output was not valid JSON matching the required schema. ' +
              'Output ONLY the corrected JSON object. No prose, no markdown code fences.]',
            temperature,
            topP,
            maxOutputTokens,
            jsonMode: true,
            cache,
          });
          finalText = extractText(retry);
          parseResult = tryParse(finalText);
          if (!parseResult.ok) {
            throw new StructuredOutputError(
              `structured output failed schema validation after retry`,
              finalText,
              { cause: parseResult.error },
            );
          }
          parsed = parseResult.value;
        } else {
          parsed = parseResult.value;
        }
      }

      const at = new Date(started).toISOString();
      // Fire-and-forget logging row. Failures in the recorder must not
      // fail the call.
      void recordCall({
        household_id: args.household_id as string,
        task: args.task,
        model: usedModel,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        at,
      });

      logger.info('model call complete', {
        household_id: args.household_id,
        task: args.task,
        model: usedModel,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        duration_ms: latencyMs,
      });

      return {
        text,
        parsed: parsed as never,
        model: usedModel,
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs,
      };
    },
  };
}
