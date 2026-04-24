'use client';

/**
 * Lightweight rich-text renderer for chat message bodies.
 *
 * Handles, in one pass, the fragments HomeHub assistant replies
 * actually contain:
 *   - `![alt](https://…)`     → responsive thumbnail (TripAdvisor photos)
 *   - `[text](https://…)`      → clickable link, opens in a new tab
 *   - `[node:<uuid>]`          → citation chip (existing)
 *   - `[episode:<uuid>]`       → citation chip (existing)
 *
 * Intentionally NOT a markdown parser. The goal is to render the shapes
 * skills actually emit (see `fun/SKILL.md`) without pulling in a 40 KB
 * markdown library. Anything that doesn't match a known pattern renders
 * as plain text, preserving the current `whitespace-pre-wrap` behavior.
 *
 * Security:
 *   - Only http(s) URLs are accepted. `javascript:`, `data:`, and other
 *     schemes fall through to plain text.
 *   - External links get `target="_blank" rel="noreferrer"`.
 *   - Images get `loading="lazy"` and a max height so a malicious host
 *     can't push a 100 MP photo into the conversation.
 */

import * as React from 'react';

const COMBINED_PATTERN = new RegExp(
  [
    // Image: ![alt](url)
    '(!\\[[^\\]]*\\]\\((?:https?:)?//[^\\s)]+\\))',
    // Link: [text](url)
    '(\\[[^\\]]+\\]\\((?:https?:)?//[^\\s)]+\\))',
    // Citation: [node:uuid] / [episode:uuid]
    '(\\[(?:node|episode):[0-9a-f-]{36}\\])',
  ].join('|'),
  'gi',
);

const IMAGE_PATTERN = /^!\[([^\]]*)\]\(((?:https?:)?\/\/[^\s)]+)\)$/i;
const LINK_PATTERN = /^\[([^\]]+)\]\(((?:https?:)?\/\/[^\s)]+)\)$/i;
const CITATION_PATTERN = /^\[(node|episode):([0-9a-f-]{36})\]$/i;

function isSafeUrl(url: string): boolean {
  // Reject anything but http(s). Protocol-relative `//host/...` is
  // allowed because browsers resolve it against the current scheme.
  if (url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function renderRichBody(body: string): React.ReactElement {
  // Split on the combined pattern with capture groups so both the
  // matches and the plain-text fragments survive.
  const parts = body.split(COMBINED_PATTERN).filter((part) => part !== undefined);

  return (
    <span>
      {parts.map((part, i) => {
        if (!part) return null;

        const imageMatch = IMAGE_PATTERN.exec(part);
        if (imageMatch) {
          const alt = imageMatch[1] ?? '';
          const url = imageMatch[2]!;
          if (!isSafeUrl(url)) {
            return <React.Fragment key={i}>{part}</React.Fragment>;
          }
          return (
            <a
              key={`${i}-img`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="my-1.5 inline-block max-w-full overflow-hidden rounded-[8px] border border-border"
            >
              <img
                src={url}
                alt={alt}
                loading="lazy"
                className="block max-h-[240px] w-auto max-w-full object-cover"
              />
            </a>
          );
        }

        const linkMatch = LINK_PATTERN.exec(part);
        if (linkMatch) {
          const text = linkMatch[1]!;
          const url = linkMatch[2]!;
          if (!isSafeUrl(url)) {
            return <React.Fragment key={i}>{part}</React.Fragment>;
          }
          return (
            <a
              key={`${i}-link`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-fg-muted decoration-[1px] underline-offset-[3px] hover:decoration-fg"
            >
              {text}
            </a>
          );
        }

        const citationMatch = CITATION_PATTERN.exec(part);
        if (citationMatch) {
          const type = citationMatch[1]!.toLowerCase() as 'node' | 'episode';
          const id = citationMatch[2]!;
          const label = id.slice(0, 8);
          return (
            <span
              key={`${i}-${id}`}
              className="mx-0.5 inline-flex items-center rounded-[3px] border border-border bg-surface-soft px-1 font-mono text-[10.5px] text-fg-muted"
            >
              <span className="mr-1 text-[9px] uppercase tracking-[0.06em]">{type}</span>
              {label}
            </span>
          );
        }

        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}
