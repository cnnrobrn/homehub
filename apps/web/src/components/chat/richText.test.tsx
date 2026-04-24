/**
 * @vitest-environment jsdom
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderRichBody } from './richText';

function rendered(body: string): HTMLElement {
  const { container } = render(renderRichBody(body));
  return container;
}

describe('renderRichBody', () => {
  it('renders plain text untouched', () => {
    const el = rendered('hello there');
    expect(el.textContent).toBe('hello there');
    expect(el.querySelector('a')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
  });

  it('renders [text](url) as a clickable link opening in a new tab', () => {
    const el = rendered('See [Grotta Palazzese](https://tripadvisor.com/x) tonight?');
    const link = el.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('https://tripadvisor.com/x');
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noreferrer');
    expect(link!.textContent).toBe('Grotta Palazzese');
  });

  it('renders ![alt](url) as an img wrapped in a link', () => {
    const el = rendered('![Sunset view](https://cdn.tacdn.com/photo.jpg)');
    const img = el.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://cdn.tacdn.com/photo.jpg');
    expect(img!.getAttribute('alt')).toBe('Sunset view');
    expect(img!.getAttribute('loading')).toBe('lazy');
    const anchor = img!.closest('a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('target')).toBe('_blank');
  });

  it('rejects unsafe URL schemes and falls back to plain text', () => {
    const el = rendered('[click me](javascript:alert(1))');
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('[click me](javascript:alert(1))');
  });

  it('preserves citation chip rendering for [node:uuid]', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const el = rendered(`see [node:${uuid}]`);
    expect(el.textContent).toContain('node');
    expect(el.textContent).toContain(uuid.slice(0, 8));
  });

  it('mixes text, link, and image in one body', () => {
    const el = rendered(
      'Top pick:\n![photo](https://cdn.tacdn.com/x.jpg)\n[Visit](https://tripadvisor.com/y) · 4.5★',
    );
    expect(el.querySelector('img')!.getAttribute('src')).toBe('https://cdn.tacdn.com/x.jpg');
    const anchors = Array.from(el.querySelectorAll('a'));
    const hrefs = anchors.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://cdn.tacdn.com/x.jpg');
    expect(hrefs).toContain('https://tripadvisor.com/y');
    expect(el.textContent).toContain('4.5★');
  });
});
