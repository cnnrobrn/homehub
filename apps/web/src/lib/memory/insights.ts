/**
 * Helpers for rendering `mem.insight.body_md` in the settings UI.
 *
 * The reflector (M3.7-A) appends a trailing HTML comment containing a
 * JSON citation footnote at the end of `body_md`:
 *
 *     ... narrative text ...
 *
 *     <!-- homehub:reflection {"citations":[{"fact_id":"...","episode_id":"..."}]} -->
 *
 * The comment is deliberately hidden from a plain markdown render but
 * we want to surface the underlying citations in a "Show citations"
 * disclosure. `stripCitationFootnote` splits the body into
 * `{ cleanBody, citations? }` so the UI can render both independently.
 *
 * Parsing rules:
 *   - The sentinel token is `homehub:reflection` inside an HTML comment
 *     at the tail of the string (possibly preceded by whitespace).
 *   - The JSON payload that follows must parse. If it does not, we
 *     return the full body as `cleanBody` and omit `citations` so the
 *     UI falls back to a clean render.
 */

export interface InsightCitation {
  fact_id?: string;
  episode_id?: string;
  node_id?: string;
  pattern_id?: string;
  // reflector may attach additional keys; keep `unknown` open.
  [key: string]: unknown;
}

export interface StrippedInsightBody {
  cleanBody: string;
  citations?: InsightCitation[];
  rawFootnote?: string;
}

// Match the trailing `<!-- homehub:reflection { ... } -->` block,
// tolerating optional whitespace on either side. `[\s\S]*?` in the
// JSON span handles embedded newlines without `s` flag dependency.
const FOOTNOTE_RE = /\s*<!--\s*homehub:reflection\s*([\s\S]*?)-->\s*$/;

export function stripCitationFootnote(bodyMd: string): StrippedInsightBody {
  const match = bodyMd.match(FOOTNOTE_RE);
  if (!match) {
    return { cleanBody: bodyMd };
  }
  const cleanBody = bodyMd.slice(0, match.index ?? 0).replace(/\s+$/, '');
  const rawFootnote = match[0].trim();
  const jsonText = (match[1] ?? '').trim();
  if (!jsonText) {
    return { cleanBody, rawFootnote };
  }
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (parsed && typeof parsed === 'object' && 'citations' in parsed) {
      const raw = (parsed as { citations?: unknown }).citations;
      if (Array.isArray(raw)) {
        const citations: InsightCitation[] = raw.filter(
          (c): c is InsightCitation => !!c && typeof c === 'object',
        );
        return { cleanBody, citations, rawFootnote };
      }
    }
    return { cleanBody, rawFootnote };
  } catch {
    // Malformed JSON — surface only the clean body; the rendered
    // comment is still accessible via `rawFootnote` for debugging.
    return { cleanBody, rawFootnote };
  }
}
