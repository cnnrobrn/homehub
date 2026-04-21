/**
 * `@homehub/prompts` — barrel.
 *
 * The runtime surface is intentionally narrow:
 *   - `loadPrompt(name)` — read + parse a markdown prompt file.
 *   - `renderPrompt(prompt, vars)` — slot-substitute a loaded prompt.
 *   - Typed schema exports for each prompt's response shape.
 *   - Typed error classes for load/render failures.
 *
 * Workers should never reach for the prompt file path directly; they go
 * through `loadPrompt`.
 */

export {
  loadPrompt,
  renderPrompt,
  _clearPromptCache,
  type Prompt,
  type RenderedPrompt,
} from './loader.js';

export { PromptLoadError, PromptRenderError } from './errors.js';

export {
  eventExtractionSchema,
  extractionEpisodeSchema,
  extractionFactSchema,
  eventClassifierSchema,
  nodeDocSchema,
  type EventExtractionResponse,
  type ExtractionEpisode,
  type ExtractionFact,
  type EventClassifierResponse,
  type NodeDocResponse,
} from './schemas.js';
