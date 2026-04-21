/**
 * Prompt-runtime error classes.
 *
 * Both carry a stable string `code` so log backends and tests can filter
 * without parsing `.message`.
 */

abstract class PromptError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when `loadPrompt(name)` cannot find a prompt file or cannot
 * parse the required markdown sections (`## System Prompt`,
 * `## User Prompt Template`, `## Version`).
 */
export class PromptLoadError extends PromptError {
  readonly code = 'PROMPT_LOAD_ERROR';
  readonly promptName: string;

  constructor(message: string, promptName: string, options?: { cause?: unknown }) {
    super(message, options);
    this.promptName = promptName;
  }
}

/**
 * Thrown by `renderPrompt` when the template contains `{{placeholder}}`
 * tokens that the caller did not supply. Catching this error indicates a
 * caller bug — the worker is missing a required slot value and should
 * not silently paper over it by sending a prompt with `{{title}}` in the
 * body.
 */
export class PromptRenderError extends PromptError {
  readonly code = 'PROMPT_RENDER_ERROR';
  readonly promptName: string;
  readonly missing: string[];

  constructor(
    message: string,
    promptName: string,
    missing: string[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.promptName = promptName;
    this.missing = missing;
  }
}
