/**
 * Model abstraction for the foreground loop.
 *
 * `ModelClient` in `@homehub/worker-runtime` is JSON/text-only. The
 * foreground loop needs a richer surface: tool calls, streaming, and
 * multi-turn messages. Rather than extend that shared client today
 * (and force every worker to inherit the complexity), this file
 * defines a narrow `ForegroundModel` interface the loop depends on.
 * A reference implementation (`createOpenRouterForegroundModel`)
 * wraps the OpenRouter Chat Completions endpoint with tool-calling
 * support.
 *
 * For M3.5-A we ship a **non-streaming** variant: the model returns a
 * full assistant message + optional tool calls in one call. The loop
 * still emits tokens to the UI (we chunk the final text) so the UX
 * has the right shape; swapping to true server-sent streaming is a
 * drop-in of this interface. This keeps the dispatch scope
 * manageable and works with every OpenRouter-routed model we use.
 */

import type { HouseholdId } from '@homehub/shared';
import type { OpenAiToolSpec } from '@homehub/tools';
import type { Logger, ServiceSupabaseClient, WorkerRuntimeEnv } from '@homehub/worker-runtime';

export interface ForegroundModelCallArgs {
  task: string;
  household_id: HouseholdId;
  systemPrompt: string;
  messages: ForegroundMessage[];
  tools?: OpenAiToolSpec[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  cache?: 'auto' | 'off';
}

export interface ForegroundToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ForegroundMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ForegroundToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ForegroundModelResult {
  assistantText: string;
  toolCalls: ForegroundToolCall[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  finishReason: string | null;
}

export interface ForegroundModel {
  generate(args: ForegroundModelCallArgs): Promise<ForegroundModelResult>;
}

export interface CreateOpenRouterForegroundModelOptions {
  supabase?: ServiceSupabaseClient;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

interface ChatChoice {
  message?: {
    content?: string | null;
    role?: string;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string;
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: ChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
}

const DEFAULT_FOREGROUND_MODEL = 'anthropic/claude-sonnet-4.5';

export function createOpenRouterForegroundModel(
  env: WorkerRuntimeEnv,
  options: CreateOpenRouterForegroundModelOptions,
): ForegroundModel {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const endpoint = `${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const logger = options.logger;

  return {
    async generate(args) {
      if (!env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not configured for foreground-agent');
      }
      const model = args.model ?? process.env.HOMEHUB_FOREGROUND_MODEL ?? DEFAULT_FOREGROUND_MODEL;
      const cache = (args.cache ?? 'auto') === 'auto';
      const started = Date.now();

      // OpenRouter prompt-caching hint. Applied only to the stable
      // system prefix, per `specs/05-agents/model-routing.md`.
      const systemContent = cache
        ? [
            {
              type: 'text',
              text: args.systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ]
        : args.systemPrompt;

      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: systemContent },
          ...args.messages.map((m) => {
            if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
              return {
                role: 'assistant',
                content: m.content,
                tool_calls: m.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                })),
              };
            }
            if (m.role === 'tool') {
              return {
                role: 'tool',
                tool_call_id: m.toolCallId,
                name: m.name,
                content: m.content,
              };
            }
            return { role: m.role, content: m.content };
          }),
        ],
        temperature: args.temperature ?? 0.5,
        max_tokens: args.maxOutputTokens ?? 4000,
        usage: { include: true },
      };

      if (args.tools && args.tools.length > 0) {
        body.tools = args.tools;
        body.tool_choice = 'auto';
      }

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
        throw new Error(`OpenRouter foreground HTTP ${res.status}: ${text.slice(0, 500)}`);
      }
      const json = (await res.json()) as ChatCompletionResponse;
      const latencyMs = Date.now() - started;
      const choice = json.choices?.[0];
      const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
      const rawToolCalls = choice?.message?.tool_calls ?? [];
      const toolCalls: ForegroundToolCall[] = rawToolCalls
        .filter((tc) => tc.type === 'function' && tc.function?.name)
        .map((tc, i) => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = tc.function?.arguments
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : {};
          } catch {
            logger.warn('foreground: tool-call arguments not valid JSON', {
              tool: tc.function?.name,
            });
          }
          return {
            id: tc.id ?? `call_${i}`,
            name: tc.function!.name!,
            arguments: parsed,
          };
        });

      const inputTokens = json.usage?.prompt_tokens ?? 0;
      const outputTokens = json.usage?.completion_tokens ?? 0;
      const costUsd = json.usage?.cost ?? 0;

      // Record to app.model_calls — the stock model-calls recorder
      // in worker-runtime is keyed to the `generate()` method on
      // `ModelClient`, which we aren't using here. Skip inline: the
      // caller passes a shim when it wants accounting (the agent loop
      // does). Keeping the generate flow lean avoids accidentally
      // double-counting when the loop wraps this with its own tracer.
      return {
        assistantText: content,
        toolCalls,
        model: json.model ?? model,
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs,
        finishReason: choice?.finish_reason ?? null,
      };
    },
  };
}
