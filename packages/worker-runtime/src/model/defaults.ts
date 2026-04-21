/**
 * Per-task default parameters for model calls.
 *
 * Mirrors the table in `specs/05-agents/model-routing.md`. Tasks not
 * explicitly listed inherit from `background` defaults.
 *
 * Callers pass a `task` string (dotted, e.g. `'enrichment.event'`); the
 * resolver walks from specific → general, so `'enrichment.event'` falls
 * back to `'enrichment'` and then to `'background'`.
 */

export interface ModelParams {
  model: string;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  jsonMode: boolean;
}

const BACKGROUND_MODEL_DEFAULT = 'moonshotai/kimi-k2';
const FOREGROUND_MODEL_DEFAULT = 'anthropic/claude-sonnet-4.5';

/**
 * Map from task prefix → default params. Longer (more specific) keys
 * win. When adding new task keys, document the decision in the
 * model-routing spec first so the spec stays authoritative.
 */
export const DEFAULTS: Record<string, ModelParams> = {
  // Catch-all: any unlisted task starts here.
  background: {
    model: BACKGROUND_MODEL_DEFAULT,
    temperature: 0.5,
    topP: 0.9,
    maxOutputTokens: 1500,
    jsonMode: false,
  },
  enrichment: {
    model: BACKGROUND_MODEL_DEFAULT,
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 2000,
    jsonMode: true,
  },
  'enrichment.event': {
    model: BACKGROUND_MODEL_DEFAULT,
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 2000,
    jsonMode: true,
  },
  'enrichment.email': {
    model: BACKGROUND_MODEL_DEFAULT,
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 2000,
    jsonMode: true,
  },
  'enrichment.transaction': {
    model: BACKGROUND_MODEL_DEFAULT,
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 2000,
    jsonMode: true,
  },
  'enrichment.meal': {
    model: BACKGROUND_MODEL_DEFAULT,
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 2000,
    jsonMode: true,
  },
  summarization: {
    model: BACKGROUND_MODEL_DEFAULT,
    temperature: 0.5,
    topP: 0.9,
    maxOutputTokens: 1500,
    jsonMode: false,
  },
  suggestion: {
    model: BACKGROUND_MODEL_DEFAULT,
    temperature: 0.4,
    topP: 0.9,
    maxOutputTokens: 1000,
    jsonMode: true,
  },
  foreground: {
    model: FOREGROUND_MODEL_DEFAULT,
    temperature: 0.5,
    topP: 0.9,
    maxOutputTokens: 4000,
    jsonMode: false,
  },
};

/**
 * Resolves params for a task by walking from specific to general. Given
 * `'enrichment.event'` it tries `enrichment.event`, then `enrichment`,
 * then `background`. If no entry matches, returns `background`.
 */
export function resolveDefaults(task: string): ModelParams {
  if (DEFAULTS[task]) return DEFAULTS[task];
  const parts = task.split('.');
  while (parts.length > 0) {
    parts.pop();
    const key = parts.join('.');
    if (key && DEFAULTS[key]) return DEFAULTS[key];
  }
  return DEFAULTS.background as ModelParams;
}
